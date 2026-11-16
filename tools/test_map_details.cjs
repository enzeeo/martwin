const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error('Browser error:', error.message); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'app.test') return route.abort();
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'selection.js', 'places.js', 'cosmic-background.js', 'observatory.css', 'fonts/geist-sans-latin.woff2', 'fonts/geist-mono-latin.woff2'].includes(path)) return route.abort();
    return route.fulfill({ status: 200, contentType: path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(require('path').join(__dirname, '../src/frontend', path)) });
  });
  await page.addInitScript(() => {
    const native = window.fetch;
    window.testRequests = [];
    window.testSelectionRequests = [];
    window.testSelectionMode = 'normal';
    window.testDelay = 0;
    window.testScoreMode = 'normal';
    window.fetch = async (url, options = {}) => {
      if (url.startsWith('/api/catalog')) return new Response(JSON.stringify({
        comparisons: [{ feature_id: 'terrain', options: [{ header: 'slope', label: 'Mean terrain slope', unit: '°', meaning: 'Slope', score_available: true }, { header: 'relief', label: 'Local relief', unit: 'm', meaning: 'Relief', score_available: true }] }],
        filters: [],
        continent_filter: { available: true, continents: ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'] },
        dataset_fields: [{ header: 'elev_mean', label: 'Mean elevation', unit: 'm', data_type: 'continuous', filter_available: true }, { header: 'tree_cover', label: 'Tree cover', unit: 'fraction (0–1)', display_unit: '%', display_scale: 100, data_type: 'fraction', filter_available: true }, { header: 'lc_major', label: 'Land-cover class', data_type: 'categorical', choices: [{value:'Bare ground',label:'Bare ground'},{value:'Grassland',label:'Grassland'}], filter_available: true }, { header: 'surface_not_ground', label: 'Surface rather than ground', data_type: 'boolean', filter_available: true }]
      }));
      if (url === '/api/select/stream') {
        window.testSelectionRequests.push(JSON.parse(options.body));
        if (window.testSelectionMode === 'error') return new Response(JSON.stringify({ detail: 'fixture selection error' }), { status: 500 });
        let i = 0;
        const events = [
          { stage: 'features' },
          { stage: 'features_selected', families: { comparisons: [{ feature_id: 'terrain', label: 'Terrain shape' }], filters: [] } },
          { stage: 'representations' },
          { stage: 'done', result: { comparisons: [{ feature_id: 'terrain', header: 'slope', label: 'Mean terrain slope', unit: '°', score_available: true, weight: 1 }, { feature_id: 'terrain', header: 'unsupported', score_available: false }], filters: [] } }
        ];
        return new Response(new ReadableStream({ async pull(controller) { await new Promise(resolve => setTimeout(resolve, 180)); if (i < events.length) controller.enqueue(new TextEncoder().encode(JSON.stringify(events[i++]) + '\n')); else controller.close(); } }));
      }
      if (url === '/api/score') {
        window.testRequests.push(JSON.parse(options.body));
        await new Promise(resolve => setTimeout(resolve, window.testDelay));
        if (window.testScoreMode === 'error') return new Response(JSON.stringify({ detail: 'fixture score error' }), { status: 500 });
        if (window.testScoreMode === 'empty') return new Response(JSON.stringify({ reference_id: 'test-empty', ranked: [] }));
        return new Response(JSON.stringify({ reference_id: 'test', mars_context: {tri_p50: 12}, context_metadata: {tri_p50: {label: 'Median terrain ruggedness', unit: 'm'}}, ranked: [
          { region_id: 'E_TEST', context: {tri_p50: 11}, rank: 1, score: 0.3, latitude: 1, longitude: 2, group_distances: { slope: 0.2, relief: 0.4 }, group_contributions: { slope: 0.1, relief: 0.2 } },
          { region_id: 'E_SECOND', rank: 27, score: 0.5, latitude: -30, longitude: 120, group_distances: { slope: 0.3, relief: 0.6 }, group_contributions: { slope: 0.1, relief: 0.4 } },
          ...Array.from({length:8}, (_,i)=>({region_id:'E_EXTRA_'+i,rank:30+i,score:0.6+i/100,latitude:40,longitude:-150+i*35}))
        ] }));
      }
      return native(url, options);
    };
  });

  await page.goto('http://app.test/');
  await page.locator('#searchButton').click();
  await page.locator('#liveSelection').waitFor({state:'visible'});
  await page.locator('#comparisons li').filter({hasText:'unsupported'}).getByRole('button',{name:'Remove'}).click();
  await page.locator('#runScore').click();
  await page.waitForFunction(() => document.querySelectorAll('#locations .place').length === 10);
  const request=await page.evaluate(() => window.testRequests[0]);
  assert.equal(request.result_count,10);
  assert.equal(request.min_separation_km,25);
  assert.equal(await page.locator('#locations .place').count(), 10);
  assert.match(await page.locator('#locations .place').nth(1).innerText(), /Western Australia, Australia/);
  assert.match(await page.evaluate(() => placeDescription({lat:41.8781,lon:-87.6298})), /Chicago, Illinois, United States of America/);
  assert.match(await page.evaluate(() => placeDescription({lat:-16.8,lon:179.9})), /Fiji/);
  await page.locator('#earthAscii').scrollIntoViewIfNeeded();
  const point = async index => {
    const box = await page.locator('#earthAscii').boundingBox();
    const pin = await page.evaluate(index => ({x:earthHitPoints[index].x,y:earthHitPoints[index].y}), index);
    return {x:box.x+pin.x,y:box.y+pin.y};
  };
  let pin = await point(1);
  await page.mouse.move(pin.x,pin.y);
  assert.equal(await page.locator('#pointDetails').isVisible(), true);
  assert.match(await page.locator('#pointDetails').innerText(), /Western Australia, Australia/);
  assert.match(await page.locator('#pointDetails').innerText(), /Rank 27/);
  let box = await page.locator('#earthAscii').boundingBox();
  await page.mouse.move(box.x+10,box.y+40);
  assert.equal(await page.locator('#pointDetails').isHidden(), true);
  await page.mouse.click(pin.x,pin.y);
  await page.mouse.move(box.x+10,box.y+40);
  assert.match(await page.locator('#pointDetails').innerText(), /PINNED/);
  assert.equal(await page.locator('#pointDetails a').getAttribute('href'), 'https://www.google.com/maps/search/?api=1&query=-30%2C120');
  let other = await point(0);
  await page.mouse.move(other.x,other.y);
  assert.match(await page.locator('#pointDetails').innerText(), /Rank 1 ·/);
  await page.mouse.move(box.x+10,box.y+40);
  assert.match(await page.locator('#pointDetails').innerText(), /Rank 27/);
  await page.locator('#pointDetails').screenshot({path:'/private/tmp/martwin-point-details.png'});
  await page.locator('#earthAscii').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pointDetails').isHidden(), true);
  await page.mouse.click(pin.x,pin.y);
  await page.getByRole('button',{name:'Close location details'}).click();
  assert.equal(await page.locator('#pointDetails').isHidden(), true);
  await page.mouse.click(pin.x,pin.y);
  await page.locator('#filterText').fill('E_TEST');
  assert.equal(await page.locator('#pointDetails').isHidden(), true);
  await page.locator('#filterText').fill('');
  await page.mouse.click(box.x+10,box.y+40);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#earthAscii').scrollIntoViewIfNeeded();
  pin=await point(1);
  await page.mouse.click(pin.x,pin.y);
  assert.equal(await page.locator('#pointDetails').isVisible(), true);
  assert.match(await page.locator('#pointDetails').innerText(), /PINNED/);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
  await page.locator('#mapSection').screenshot({path:'/private/tmp/martwin-map-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#earthAscii').scrollIntoViewIfNeeded();
  pin=await point(1);
  await page.mouse.move(pin.x,pin.y);
  await page.mouse.down();
  await page.mouse.move(pin.x+60,pin.y+40,{steps:5});
  await page.mouse.up();
  assert.match(await page.locator('#pointDetails').innerText(), /Rank 27/);
  await page.locator('#mapSection').screenshot({ path: '/private/tmp/pixel-map.png' });

  await page.evaluate(() => clearResults());
  assert.equal(await page.locator('#pointDetails').isHidden(),true);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: 10-result / 25-km request, place labels, hover preview, click pin, preview restoration, Escape/close, filtering, panning, mobile pin and layout, stale-result cleanup');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
