const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
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
        comparisons: [
          { feature_id: 'terrain', options: [{ header: 'slope', label: 'Mean terrain slope', unit: '°', meaning: 'Slope', score_available: true }, { header: 'relief', label: 'Local relief', unit: 'm', meaning: 'Relief', score_available: true }] },
          { feature_id: 'surface', options: [{ header: 'tes_albedo', label: 'Albedo', score_available: true }] }
        ],
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
          { region_id: 'E_SECOND', rank: 27, score: 0.5, latitude: -30, longitude: 120, group_distances: { slope: 0.3, relief: 0.6 }, group_contributions: { slope: 0.1, relief: 0.4 } }
        ] }));
      }
      return native(url, options);
    };
  });

  await page.goto('http://app.test/');
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => ['Geist Sans','Geist Mono'].every(name => [...document.fonts].some(face => face.family.replaceAll('\"','') === name && face.status === 'loaded'))));
  assert.deepEqual(await page.locator('.coord-row input').evaluateAll(inputs => inputs.map(input => input.id)), ['latitude', 'longitude']);
  assert.equal(await page.locator('#latitude').inputValue(), '18.4446');
  assert.equal(await page.locator('#longitude').inputValue(), '77.4509');
  assert.equal(await page.locator('#demoSearch').count(), 0);
  await page.locator('#searchButton').click();
  await page.waitForFunction(() => document.querySelector('#liveProgressStatus').textContent.includes('Select features'));
  const selectionRequest = await page.evaluate(() => window.testSelectionRequests[0]);
  assert.equal(selectionRequest.latitude, 18.4446);
  assert.equal(selectionRequest.longitude, 77.4509);
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  assert.equal(await page.locator('#liveProgress').isVisible(), true);
  await page.waitForFunction(() => document.querySelector('#liveProgressStatus').textContent.includes('Choose representations'));
  await page.locator('#liveSelection').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#comparisons li').count(), 2);
  assert.equal(await page.locator('#selectionTitle').innerText(), 'Review your search');
  assert.match(await page.locator('#runScore').innerText(), /Find Earth matches/);
  assert.deepEqual(await page.locator('#continents input').evaluateAll(inputs => inputs.map(input => input.value)), ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']);
  assert.equal(await page.locator('#continents input:checked').count(), 7);
  assert.match(await page.locator('#liveStages').innerText(), /Terrain shape/);
  assert.match(await page.locator('#liveStages').innerText(), /Mean terrain slope/);
  assert.match(await page.locator('#recordedTrace pre').textContent(), /features_selected/);
  assert.match(await page.locator('#recordedTrace pre').textContent(), /Terrain shape/);
  assert.equal(await page.locator('#traceDisclosure').getAttribute('open'), null);
  await page.locator('#traceDisclosure > summary').click();
  assert.equal(await page.locator('#recordedTrace').isVisible(), true);
  await page.locator('#traceDisclosure > summary').click();
  const featureDetails = page.getByRole('button', { name: 'Details for Mean terrain slope', exact: true });
  await featureDetails.click();
  assert.equal(await featureDetails.getAttribute('aria-expanded'), 'true');
  await featureDetails.click();
  assert.equal(await page.locator('#familyMenu').isHidden(), true);
  assert.equal(await page.locator('#filterMenu').isHidden(), true);
  await page.locator('#searchOptions summary').first().click();
  await page.locator('.continent-settings summary').click();

  await page.locator('#runScore').click();
  assert.match(await page.locator('#scoreStatus').innerText(), /Remove unavailable/);
  await page.locator('#comparisons li').filter({ hasText: 'unsupported' }).getByRole('button', { name: 'Remove' }).click();
  await page.locator('[aria-label="Weight for Mean terrain slope"]').fill('100');
  await page.locator('#toggleFamily').click();
  const featureSearch = page.getByLabel('Search features', { exact: true });
  const featureOptions = page.locator('#addFamily option');
  assert.deepEqual(await featureOptions.allTextContents(), ['Albedo', 'Local relief']);
  await featureSearch.fill(' TES_ALB ');
  assert.deepEqual(await featureOptions.allTextContents(), ['Albedo']);
  await featureSearch.fill('nothing matches');
  assert.deepEqual(await featureOptions.allTextContents(), ['No matching features']);
  assert.equal(await page.locator('#addFamilyBtn').isDisabled(), true);
  await featureSearch.fill('RELIEF');
  assert.deepEqual(await featureOptions.allTextContents(), ['Local relief']);
  await page.locator('#addFamilyBtn').click();
  await page.locator('#toggleFamily').click();
  assert.equal(await featureSearch.inputValue(), '');
  assert.deepEqual(await featureOptions.allTextContents(), ['Albedo']);
  await page.locator('#toggleFamily').click();
  await page.locator('[aria-label="Weight for Local relief"]').fill('70');
  await page.locator('#toggleFilter').click();
  await page.locator('#addFilter').selectOption('dataset_field/elev_mean');
  await page.locator('#addFilterBtn').click();
  assert.equal(await page.getByLabel('Operator for Mean elevation', { exact: true }).locator('option[value="between"]').isDisabled(), false);
  await page.getByLabel('Operator for Mean elevation', { exact: true }).selectOption('between');
  await page.getByLabel('Value for Mean elevation', { exact: true }).fill('500');
  await page.getByLabel('Maximum for Mean elevation', { exact: true }).fill('2000');
  await page.locator('#searchOptions summary').first().click();
  await page.locator('#liveSelection').screenshot({ path: '/private/tmp/pixel-plan.png' });
  await page.locator('#searchOptions summary').first().click();
  for (const header of ['tree_cover', 'lc_major', 'surface_not_ground']) {
    if (await page.locator('#filterMenu').isHidden()) await page.locator('#toggleFilter').click();
    await page.locator('#addFilter').selectOption('dataset_field/' + header);
    await page.locator('#addFilterBtn').click();
  }
  await page.getByLabel('Operator for Tree cover', {exact:true}).selectOption('<');
  await page.getByLabel('Value for Tree cover', {exact:true}).fill('10');
  await page.getByLabel('Operator for Land-cover class', {exact:true}).selectOption('in');
  await page.getByLabel('Search choices for Land-cover class', {exact:true}).fill('ground');
  await page.getByLabel('Search choices for Land-cover class', {exact:true}).fill('');
  await page.getByLabel('Value for Land-cover class', {exact:true}).selectOption(['Bare ground','Grassland']);
  await page.getByLabel('Operator for Surface rather than ground', {exact:true}).selectOption('==');
  await page.getByLabel('Value for Surface rather than ground', {exact:true}).selectOption('false');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#runScore').click();
  await page.locator('#mapSection').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.testRequests.length === 1);
  const firstRequest = await page.evaluate(() => window.testRequests[0]);
  assert.equal(firstRequest.latitude, 18.4446);
  assert.equal(firstRequest.longitude, 77.4509);
  assert.equal(firstRequest.result_count, 10);
  assert.equal(firstRequest.min_separation_km, 25);
  assert.deepEqual(firstRequest.selected_continents, ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']);
  assert.deepEqual(firstRequest.filters, [{ feature_id: 'dataset_field', header: 'elev_mean', operator: 'between', value: 500, value_max: 2000 }, {feature_id:'dataset_field',header:'tree_cover',operator:'<',value:0.1}, {feature_id:'dataset_field',header:'lc_major',operator:'in',value:['Bare ground','Grassland']}, {feature_id:'dataset_field',header:'surface_not_ground',operator:'==',value:false}]);
  assert.deepEqual(firstRequest.comparisons.map(item => [item.header, item.weight]), [['slope', 0.3], ['relief', 0.7]]);
  assert.match(await page.locator('#listHeading').innerText(), /Ranked/i);
  assert.match(await page.locator('#nativeContext').textContent(), /Median terrain ruggedness/);
  assert.match(await page.locator('#nativeContext').textContent(), /12 m/);
  await page.locator('#mapSection').screenshot({ path: '/private/tmp/pixel-map.png' });

  await page.locator('#continents input[value="Africa"]').uncheck();
  assert.equal(await page.locator('#nativeContext').count(), 0);
  assert.equal(await page.locator('#pointDetails').isHidden(), true);
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  await page.locator('#runScore').click();
  await page.waitForFunction(() => window.testRequests.length === 2);
  const uncheckedRequest = await page.evaluate(() => window.testRequests[1]);
  assert.deepEqual(uncheckedRequest.selected_continents, ['Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']);
  await page.locator('#mapSection').waitFor({ state: 'visible' });

  await page.locator('#continents input').evaluateAll(inputs => inputs.forEach(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); }));
  assert.equal(await page.locator('#continents input:checked').count(), 0);
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  await page.locator('#runScore').click();
  await page.waitForFunction(() => window.testRequests.length === 3);
  const emptyRequest = await page.evaluate(() => window.testRequests[2]);
  assert.deepEqual(emptyRequest.selected_continents, []);
  await page.locator('#mapSection').waitFor({ state: 'visible' });

  await page.locator('#filterText').fill('E_TEST');
  assert.match(await page.locator('#listHeading').innerText(), /Ranked/i);
  await page.locator('[aria-label="Weight for Mean terrain slope"]').fill('50');
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  await page.locator('#runScore').click();
  await page.locator('#mapSection').waitFor({ state: 'visible' });

  await page.evaluate(() => window.testScoreMode = 'error');
  await page.locator('#runScore').click();
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  await page.waitForFunction(() => window.testRequests.length === 5);
  await page.waitForFunction(() => document.querySelector('#scoreStatus').textContent === 'fixture score error');
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  assert.doesNotMatch(await page.locator('#locations').innerText(), /Atacama Desert|Death Valley|reference site/i);

  await page.evaluate(() => window.testScoreMode = 'normal');
  await page.locator('#runScore').click();
  await page.waitForFunction(() => window.testRequests.length === 6);
  await page.locator('#mapSection').waitFor({ state: 'visible' });

  await page.evaluate(() => window.testScoreMode = 'empty');
  await page.locator('#runScore').click();
  await page.waitForFunction(() => window.testRequests.length === 7);
  await page.locator('#mapSection').waitFor({ state: 'visible' });
  assert.equal((await page.locator('#locations').innerText()).includes('No results returned. Try changing your filters or separation.'), true);
  assert.equal(await page.locator('#resultCount').innerText(), '0 / 0 ranked locations');

  await page.evaluate(() => window.testScoreMode = 'normal');
  await page.locator('#runScore').click();
  await page.waitForFunction(() => window.testRequests.length === 8);
  await page.locator('#mapSection').waitFor({ state: 'visible' });
  await page.locator('#separation').fill('125');
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  await page.evaluate(() => window.testDelay = 500);
  await page.locator('#runScore').click();
  await page.locator('#objective').fill('Changed objective');
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#mapSection').isHidden(), false);
  assert.equal(await page.locator('#mapTitle').innerText() === 'Method D results', false);
  assert.doesNotMatch(await page.locator('#locations').innerText(), /Atacama Desert|Death Valley|reference site/i);
  await page.evaluate(() => window.testSelectionMode = 'error');
  await page.locator('#searchButton').click();
  await page.waitForFunction(() => document.querySelector('#formStatus').textContent.includes('fixture selection error'));
  assert.equal(await page.locator('#mapSection').isHidden(), true);
  assert.doesNotMatch(await page.locator('#locations').innerText(), /Atacama Desert|Death Valley|reference site/i);
  assert.equal(await page.locator('#motionToggle').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#runScore').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(pageErrors, []);
  console.log('PASS: Geist fonts, compact review, percentage weights, fraction conversion, typed filters, trace labels, continent payloads, spacing, error/retry, empty results, reduced motion, mobile, cancellation');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
