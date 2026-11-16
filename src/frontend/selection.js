(() => {
  const form = $('searchForm');
  let pending, scoreRequest, menu;
  let plan = { comparisons: [], filters: [], input: undefined };
  let recordedTrace = [], families = { comparisons: [], filters: [] };
  const friendly = item => item.label || item.description || item.header?.replaceAll('_', ' ') || item.feature_id?.replaceAll('_', ' ');
  const changed = () => { if (mode !== 'live') $('scoreStatus').textContent = ''; invalidateResults(); renderDiagram('review'); };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function rowDetails(item, content) {
    const button = el('button', 'ⓘ', 'details-toggle'); button.type = 'button'; button.setAttribute('aria-label', `Details for ${friendly(item)}`); button.setAttribute('aria-expanded', 'false');
    const body = el('div', content.filter(Boolean).join(' · '), 'row-detail-body'); body.hidden = true;
    button.onclick = () => { body.hidden = !body.hidden; button.setAttribute('aria-expanded', String(!body.hidden)); };
    return { button, body };
  }


  cancelRun = function (message = true) {
    if (pending) { pending.abort(); pending = undefined; }
    if (scoreRequest) { scoreRequest.abort(); scoreRequest = undefined; $('liveSelection').querySelectorAll('button, input, select').forEach(node => { node.disabled = false; }); $('continents').querySelectorAll('input').forEach(node => { node.disabled = !menu?.continent_filter?.available; }); }
    $('nativeContext')?.remove();
    $('liveProgress').hidden = true;
    $('liveSelection').hidden = true;
    if (mode === 'live') clearResults();
    $('searchButton').disabled = false;
    $('cancel').hidden = true;
    if (message) setStatus('Stopped waiting for the selection.');
  };
  async function loadMenu(input) {
    const response = await fetch(`/api/catalog?latitude=${input.lat}&longitude=${input.lon}`);
    if (!response.ok) throw Error('Could not load the feature catalog.');
    menu = await response.json();
    const available = menu.continent_filter?.available === true; $('continents').querySelectorAll('input').forEach(input => { input.disabled = !available; }); $('continentStatus').textContent = available ? 'Applied before scoring and combined with all Earth filters.' : 'Continent masks are unavailable; continent filtering will not be applied.';
  }
  function fillSelect(id, entries) {
    const select = $(id);
    select.replaceChildren(...entries.map(([value, text]) => Object.assign(document.createElement('option'), { value, textContent: text })));
    select.disabled = entries.length === 0;
    $(`${id}Btn`).disabled = entries.length === 0;
  }
  function invalidateResults() {
    $('nativeContext')?.remove();
    if (mode === 'live') { clearResults(); $('scoreResult').hidden = true; $('scoreStatus').textContent = 'Plan changed. Select Find Earth matches to update results.'; }
  }
  function balanceWeights(edited) {
    const items = plan.comparisons.filter(item => item.score_available);
    if (!items.length || items.some(item => !Number.isFinite(item.weight) || item.weight <= 0)) return;
    if (items.length === 1) { items[0].weight = 1; return; }
    const fixed = edited ? Math.min(101 - items.length, Math.max(1, Math.round(edited.weight * 100))) : 0;
    const others = items.filter(item => item !== edited), budget = 100 - fixed;
    const total = others.reduce((sum, item) => sum + item.weight, 0);
    const exact = others.map(item => item.weight / total * budget);
    const cents = exact.map(value => Math.max(1, Math.floor(value)));
    let remaining = budget - cents.reduce((sum, value) => sum + value, 0);
    while (remaining) {
      const direction = Math.sign(remaining);
      let best = -1;
      cents.forEach((value, i) => {
        if (direction < 0 && value === 1) return;
        if (best < 0 || direction * (exact[i] - value) > direction * (exact[best] - cents[best])) best = i;
      });
      cents[best] += direction; remaining -= direction;
    }
    others.forEach((item, i) => { item.weight = cents[i] / 100; });
    if (edited) edited.weight = fixed / 100;
  }
  function renderPlan() {
    const comparisons = $('comparisons');
    comparisons.replaceChildren();
    if (!plan.comparisons.length) comparisons.append(el('li', 'Add a feature to compare.', 'empty-row'));
    for (const item of plan.comparisons) {
      const li = el('li');
      const heading = el('div', undefined, 'comparison-heading'); const name = el('div', undefined, 'comparison-name'); name.append(el('strong', friendly(item))); if (item.unit) name.append(el('span', ` ${item.display_unit || item.unit}`, 'micro')); if (item.caution || /proxy/i.test(item.scoring_status || '')) name.append(el('span', 'Proxy / caution', 'caution')); heading.append(name); li.append(heading);
      const details = rowDetails(item, [item.header, item.unit, item.meaning, item.definition, item.description, item.reason, item.caution, item.source, item.scoring_status?.replaceAll('_', ' ')]); li.append(details.body);
      if (!item.score_available) li.append(el('p', 'Context only: scoring data is unavailable for this representation.'));
      const row = el('div', undefined, 'plan-row');
      if (item.score_available) {
        const label = el('label', '', 'weight-label');
        const input = document.createElement('input');
        Object.assign(input, { type: 'number', min: '1', max: '100', step: '1', value: Math.round(item.weight * 100), className: 'weight-input' });
        input.setAttribute('aria-label', `Weight for ${friendly(item)}`);
        input.oninput = () => { item.weight = Number(input.value) / 100; changed(); };
        input.onchange = () => {
          balanceWeights(item);
          const items = plan.comparisons.filter(entry => entry.score_available);
          comparisons.querySelectorAll('.weight-input').forEach((field, i) => { field.value = Math.round(items[i].weight * 100); });
        };
        label.append(input, document.createTextNode('%')); row.append(label);
      }
      const remove = el('button', '×', 'remove-row');
      remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${friendly(item)}`);
      remove.onclick = () => { plan.comparisons = plan.comparisons.filter(entry => entry !== item); balanceWeights(); changed(); renderPlan(); $('toggleFamily').focus(); };
      row.append(details.button, remove); heading.append(row); comparisons.append(li);
    }
    const filters = $('filters');
    filters.replaceChildren();
    if (!plan.filters.length) filters.append(el('li', 'No Earth filter fields selected.'));
    for (const item of plan.filters) {
      const li = el('li', undefined, 'filter-row'); const header = el('div', undefined, 'filter-heading'); const name = el('div', undefined, 'comparison-name'); name.append(el('strong', friendly(item))); header.append(name);
      const details = rowDetails(item, [item.header, item.unit, item.definition, item.description, item.reason, item.caution, item.source]);
      const remove = el('button', '×', 'remove-row'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${friendly(item)}`); remove.onclick = () => { plan.filters = plan.filters.filter(entry => entry !== item); changed(); renderPlan(); $('toggleFilter').focus(); }; li.append(header, details.body);
      if (item.filter_available === false) li.append(el('p', 'Unavailable in the prepared Earth data.', 'micro'));
      const row = el('div', undefined, 'filter-controls'); const op = document.createElement('select'); op.setAttribute('aria-label', `Operator for ${friendly(item)}`);
      const numeric = ['continuous','fraction','percentage','ordinal','count','coordinate'].includes(item.data_type), category = item.data_type === 'categorical', boolean = item.data_type === 'boolean';
      const operators = numeric ? [['>','Greater than'],['>=','At least'],['<','Less than'],['<=','At most'],['==','Equals'],['!=','Does not equal'],['between','Between']] : category ? [['==','Is'],['!=','Is not'],['in','Is one of']] : boolean ? [['==','Is']] : [];
      for (const [value, label] of [['','Suggested · inactive'], ...operators, ['has_data','Has data'],['missing','Missing']]) { const option = el('option', label); option.value = value; op.append(option); }
      op.value = item.operator || ''; op.disabled = item.filter_available === false;
      const choiceSearch = document.createElement('input'); choiceSearch.type = 'search'; choiceSearch.placeholder = 'Search choices'; choiceSearch.setAttribute('aria-label', `Search choices for ${friendly(item)}`); choiceSearch.hidden = true;
      const value = document.createElement(numeric ? 'input' : 'select'); value.setAttribute('aria-label', `Value for ${friendly(item)}`);
      const max = document.createElement('input'); Object.assign(max, {type:'number', step:'any', placeholder:'Maximum', value:item.value_max === undefined ? '' : item.value_max * (item.display_scale || 1)}); max.setAttribute('aria-label', `Maximum for ${friendly(item)}`);
      if (numeric) { Object.assign(value, {type:'number', step:'any', placeholder:'Value', value:item.value === undefined ? '' : item.value * (item.display_scale || 1)}); }
      else if (boolean) { for (const [v, label] of [['','Choose'],['true','Yes'],['false','No']]) { const o=el('option',label); o.value=v; value.append(o); } value.value = item.value === undefined ? '' : String(item.value); }
      else if (category) { const placeholder = el('option', 'Choose'); placeholder.value = ''; value.append(placeholder); for (const choice of item.choices || []) { const o=el('option',choice.label); o.value=choice.value; value.append(o); } }
      choiceSearch.oninput = () => { const term = choiceSearch.value.toLowerCase(); for (const option of value.options) option.hidden = !!option.value && !option.textContent.toLowerCase().includes(term); };
      const unit = el('span', item.display_unit || item.unit || '', 'filter-unit');
      const sync = () => { value.hidden = !op.value || ['has_data','missing'].includes(op.value); choiceSearch.hidden = !category || value.hidden; unit.hidden = !numeric || value.hidden; max.hidden = op.value !== 'between'; if (category) { value.multiple = op.value === 'in'; for (const option of value.options) option.selected = Array.isArray(item.value) ? item.value.includes(option.value) : option.value === item.value; } };
      op.onchange = () => { item.operator = op.value || undefined; item.value = undefined; value.value = ''; sync(); changed(); };
      value.onchange = value.oninput = () => { if (numeric) item.value = value.value === '' ? undefined : Number(value.value) / (item.display_scale || 1); else if (boolean) item.value = value.value === '' ? undefined : value.value === 'true'; else item.value = value.multiple ? [...value.selectedOptions].map(option => option.value).filter(Boolean) : value.value || undefined; changed(); };
      max.oninput = () => { item.value_max = max.value === '' ? undefined : Number(max.value) / (item.display_scale || 1); changed(); }; sync(); row.append(op, choiceSearch, value, max, unit); header.append(row, details.button, remove); filters.append(li);
    }
    const used = new Set(plan.comparisons.map(item => item.header));
    const term = $('featureSearch').value.toLowerCase();
    fillSelect('addFamily', menu.comparisons.flatMap(family => family.options
      .filter(option => !used.has(option.header) && option.score_available && `${friendly(option)} ${option.header}`.toLowerCase().includes(term))
      .map(option => [`${family.feature_id}/${option.header}`, friendly(option)])));
    const chosen = new Set(plan.filters.map(item => `${item.feature_id}/${item.header}`));
    const query = $('filterSearch').value.toLowerCase();
    const filterOptions = [...menu.filters.flatMap(family => family.options.map(option => ({...option, feature_id: family.feature_id}))), ...(menu.dataset_fields || []).map(option => ({...option, feature_id:'dataset_field'}))];
    fillSelect('addFilter', filterOptions.filter(option => !chosen.has(`${option.feature_id}/${option.header}`) && `${friendly(option)} ${option.header}`.toLowerCase().includes(query))
      .map(option => [`${option.feature_id}/${option.header}`, `${friendly(option)}${option.filter_available === false ? ' · unavailable' : ''}`]));
  }
  $('addFamilyBtn').onclick = () => {
    const [feature_id, header] = $('addFamily').value.split('/');
    const option = menu.comparisons.find(f => f.feature_id === feature_id)?.options.find(o => o.header === header);
    if (option) { const count = plan.comparisons.filter(item => item.score_available).length; plan.comparisons.push({ ...option, feature_id, weight: count ? 1 / count : 1 }); balanceWeights(); changed(); }
    renderPlan(); $('familyMenu').hidden = true; $('toggleFamily').setAttribute('aria-expanded', 'false'); $('toggleFamily').focus();
  };
  $('addFilterBtn').onclick = () => {
    const [feature_id, header] = $('addFilter').value.split('/');
    const option = feature_id === 'dataset_field' ? (menu.dataset_fields || []).find(o => o.header === header) : menu.filters.find(f => f.feature_id === feature_id)?.options.find(o => o.header === header);
    if (option) { plan.filters.push({ ...option, feature_id }); changed(); }
    renderPlan(); $('filterMenu').hidden = true; $('toggleFilter').setAttribute('aria-expanded', 'false'); $('toggleFilter').focus();
  };
  const continents = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];
  for (const name of continents) { const label = el('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = name; input.checked = true; input.onchange = () => { changed(); $('continents').previousElementSibling.previousElementSibling.querySelector('span').textContent = `· ${$('continents').querySelectorAll('input:checked').length} of 7 selected`; }; label.append(input, document.createTextNode(name)); $('continents').append(label); }
  $('resultLimit').oninput = changed; $('separation').oninput = changed;
  for (const [button, panel, search] of [['toggleFamily','familyMenu','featureSearch'], ['toggleFilter','filterMenu','filterSearch']]) $(button).onclick = () => { const open = $(panel).hidden; $(panel).hidden = !open; $(button).setAttribute('aria-expanded', String(open)); if (open) $(search).focus(); };
  $('featureSearch').oninput = renderPlan; $('filterSearch').oninput = renderPlan;
  $('runScore').onclick = async () => {
    const status = $('scoreStatus'), output = $('scoreResult');
    output.hidden = true; output.textContent = '';
    $('nativeContext')?.remove();
    const comparisons = plan.comparisons;
    if (comparisons.some(item => !item.score_available)) { status.textContent = 'Remove unavailable context-only representations before scoring.'; return; }
    if (!comparisons.length) { status.textContent = 'Add at least one scorable comparison before scoring.'; return; }
    if (comparisons.some(item => !Number.isFinite(item.weight) || item.weight <= 0)) { status.textContent = 'Each weight must be a positive number.'; return; }
    const activeFilters = plan.filters.filter(item => item.operator);
    if (activeFilters.some(item => item.filter_available === false || (!['has_data','missing'].includes(item.operator) && (item.value === undefined || (Array.isArray(item.value) && !item.value.length) || (typeof item.value === 'number' && !Number.isFinite(item.value)))) || (item.operator === 'between' && (!Number.isFinite(item.value_max) || item.value > item.value_max)))) { status.textContent = 'Check filter availability and numeric values.'; return; }
    const result_count = Number($('resultLimit').value), min_separation_km = Number($('separation').value);
    if (!Number.isInteger(result_count) || result_count < 1 || result_count > 100 || !Number.isFinite(min_separation_km) || min_separation_km < 0) { status.textContent = 'Choose 1–100 results and a nonnegative separation.'; return; }
    if (mode === 'live') clearResults();
    $('runScore').disabled = true; status.textContent = 'Scoring the reviewed plan…';
    const request = new AbortController(); scoreRequest = request;
    $('liveSelection').querySelectorAll('button, input, select').forEach(node => { node.disabled = true; });
    try {
      const response = await fetch('/api/score', { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        longitude: plan.input.lon, latitude: plan.input.lat, objective: plan.input.objective,
        comparisons: comparisons.map(({ feature_id, header, weight }) => ({ feature_id, header, weight })),
        result_count, min_separation_km, ...(menu.continent_filter?.available ? { selected_continents: [...$('continents').querySelectorAll('input:checked')].map(input => input.value) } : {}),
        filters: activeFilters.map(({ feature_id, header, operator, value, value_max }) => ({ feature_id, header, operator, ...(!['has_data','missing'].includes(operator) ? {value} : {}), ...(operator === 'between' ? {value_max} : {}) }))
      }) });
      const data = await response.json();
      if (scoreRequest !== request) return;
      if (!response.ok) throw Error(Array.isArray(data.detail) ? data.detail.map(d => d.msg).join(' ') : data.detail || 'Scoring could not be completed.');
      output.textContent = JSON.stringify(data, null, 2); output.hidden = false;
      status.textContent = 'Scoring complete.';
      $('nativeContext')?.remove();
      const context = el('details'); context.id = 'nativeContext';
      context.append(el('summary', 'Native measurements · context only'));
      for (const [name, values] of [['Mars target', data.mars_context || {}], ...(data.ranked || []).map(row => [row.region_id, row.context || {}])]) {
        const site = el('details'); site.append(el('summary', name));
        const list = el('dl');
        for (const [header, value] of Object.entries(values)) {
          const field = data.context_metadata?.[header] || {};
          list.append(el('dt', field.label || header), el('dd', `${typeof value === 'number' ? Number(value.toPrecision(6)) : value}${field.unit ? ' ' + field.unit : ''}`));
        }
        site.append(list); context.append(site);
      }
      output.before(context);
      if (Array.isArray(data.ranked)) {
        mode = 'live'; recorded = { run_id: 'live Method D', revision: data.reference_id || 'not supplied' };
        locations = data.ranked.map((row, index) => ({ name: row.region_id, region_id: row.region_id, lat: row.latitude, lon: row.longitude, score: row.score, elevation_m: row.elevation_m, rank: row.rank, marker: index + 1, group_distances: row.group_distances, group_contributions: row.group_contributions, environment: 'unspecified' }));
        window.resultFeatureLabels = Object.fromEntries(comparisons.flatMap(item => [[item.feature_id, friendly(item)], [item.header, friendly(item)]]));
        selectedId = null; $('filterText').value = ''; populateEnvironments(); renderLocations();
        setPlanet('earth');
        $('mapTitle').textContent = 'Method D results'; $('listHeading').textContent = 'Ranked Earth locations';
        $('listDescription').textContent = 'Locations scored using your reviewed representations and weights.';
        $('mapStatus').textContent = `Natural Earth 1:110m · ${data.ranked.length} of ${result_count} requested · minimum separation ${min_separation_km} km`; earthView={lat:0,lon:0,zoom:1}; drawAsciiEarth();
      }
    } catch (error) { if (scoreRequest === request) status.textContent = error.message || 'Could not reach the scoring service.'; }
    finally { if (scoreRequest === request) { scoreRequest = undefined; $('liveSelection').querySelectorAll('button, input, select').forEach(node => { node.disabled = false; }); $('continents').querySelectorAll('input').forEach(input => { input.disabled = !menu.continent_filter?.available; }); renderPlan(); $('runScore').focus(); } }
  };
  function connectDiagram(canvas) {
    const svg = canvas.querySelector('svg'), bounds = canvas.getBoundingClientRect();
    if (!bounds.width) return;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const port = (node, right) => { const r = node.getBoundingClientRect(); return [r[right ? 'right' : 'left'] - bounds.left, r.top + r.height / 2 - bounds.top]; };
    const connect = (from, to) => {
      const [x1, y1] = port(from, true), [x2, y2] = port(to, false), bend = (x2 - x1) * .55;
      const d = `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d); path.setAttribute('pathLength', '100'); path.setAttribute('class', 'flow-edge'); svg.append(path);
      if (!canvas.closest('.live-diagram').classList.contains('is-running')) return;
      const packet = document.createElementNS(svg.namespaceURI, 'rect');
      for (const [key, value] of Object.entries({x:-2, y:-2, width:4, height:4, class:'flow-packet'})) packet.setAttribute(key, value);
      const motion = document.createElementNS(svg.namespaceURI, 'animateMotion');
      for (const [key, value] of Object.entries({path:d, dur:'2.8s', begin:`-${(svg.childElementCount * .31) % 2.8}s`, repeatCount:'indefinite'})) motion.setAttribute(key, value);
      packet.append(motion); svg.append(packet);
    };
    const input = canvas.querySelector('.flow-input'), output = canvas.querySelector('.flow-output');
    for (const lane of canvas.querySelectorAll('.diagram-lane')) {
      const family = lane.firstElementChild, measures = [...lane.querySelectorAll('.diagram-measures > .live-node')];
      connect(input, family);
      if (measures.length) for (const measure of measures) { connect(family, measure); connect(measure, output); }
      else connect(family, output);
    }
    if (canvas.closest('.motion-paused')) svg.pauseAnimations();
  }
  const diagramObserver = new ResizeObserver(entries => entries.forEach(({target}) => connectDiagram(target)));
  $('traceDisclosure').addEventListener('toggle', () => {
    if ($('traceDisclosure').open) {
      const canvas = $('recordedTrace').querySelector('.diagram-canvas');
      if (canvas) diagramObserver.observe(canvas);
    }
  });
  function renderDiagram(stage, reveal = false) {
    diagramObserver.disconnect();
    const host = $('liveStages'), running = ['features', 'representations'].includes(stage);
    const paused = host.classList.contains('motion-paused');
    host.className = `live-diagram${running ? ' is-running' : ''}${paused ? ' motion-paused' : ''}`; host.replaceChildren();
    const node = (label, text, active, description) => {
      const n = el('div', undefined, `live-node${active ? ' active' : ''}`); n.append(el('small', label));
      if (description && description !== text) { const detail = el('details'); detail.append(el('summary', text), el('p', description)); n.append(detail); }
      else n.append(el('strong', text));
      return n;
    };
    const toolbar = el('div', undefined, 'flow-toolbar');
    toolbar.append(el('span', '01 INPUT / 02 FEATURES / 03 PLAN'));
    if (running) {
      const pause = el('button', paused ? '[ RESUME ]' : '[ PAUSE ]', 'flow-pause'); pause.type = 'button'; pause.setAttribute('aria-label', 'Pause diagram animation'); pause.setAttribute('aria-pressed', String(paused));
      pause.onclick = () => { const stopped = host.classList.toggle('motion-paused'); pause.textContent = stopped ? '[ RESUME ]' : '[ PAUSE ]'; pause.setAttribute('aria-pressed', String(stopped)); const svg = host.querySelector('svg'); if (stopped) svg.pauseAnimations(); else svg.unpauseAnimations(); };
      toolbar.append(pause);
    }
    const canvas = el('div', undefined, `diagram-canvas${stage === 'review' ? ' has-measures' : ''}${reveal ? ' flow-reveal' : ''}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'flow-wires'); svg.setAttribute('aria-hidden', 'true'); canvas.append(svg);
    const input = node('01 / INPUT', 'Research question', stage === 'features'); input.classList.add('flow-input'); canvas.append(input);
    const branch = el('div', undefined, 'live-branches');
    const entries = [...(families.comparisons || []).map(f => ({...f, kind:'comparison'})), ...(families.filters || []).map(f => ({...f, kind:'filter'}))];
    if (stage === 'review') for (const [kind, items] of [['comparison', plan.comparisons], ['filter', plan.filters]]) for (const item of items) if (!entries.some(f => f.kind === kind && f.feature_id === item.feature_id)) entries.push({kind, feature_id:item.feature_id, description:item.feature_id === 'dataset_field' ? 'Earth conditions' : item.feature_id.replaceAll('_',' ')});
    if (!entries.length) { const lane = el('div', undefined, 'diagram-lane'); lane.append(node('02 / FEATURES', stage === 'features' ? 'Selecting features…' : stage === 'stopped' ? 'Selection stopped' : stage === '' ? 'Waiting for selection…' : 'No families reported', stage === 'features')); branch.append(lane); }
    for (const f of entries) {
      const lane = el('div', undefined, 'diagram-lane'); lane.append(node(f.kind.toUpperCase(), f.label || f.feature_id.replaceAll('_', ' '), false, f.description));
      const measures = el('div', undefined, 'diagram-measures');
      const items = (f.kind === 'comparison' ? plan.comparisons : plan.filters).filter(item => item.feature_id === f.feature_id);
      if (stage === 'review') for (const item of items) measures.append(node(f.kind === 'filter' ? (item.operator ? 'ACTIVE FILTER' : 'SUGGESTED FILTER') : 'MEASUREMENT', friendly(item) + (f.kind === 'filter' && item.operator ? ` · ${item.operator}${item.value !== undefined ? ' ' + item.value : ''}${item.value_max !== undefined && item.operator === 'between' ? '–' + item.value_max : ''}` : ''), false));
      lane.append(measures); branch.append(lane);
    }
    canvas.append(branch);
    const output = node('03 / PLAN', stage === 'review' ? `${plan.comparisons.length} comparisons · ${plan.filters.filter(f => f.operator).length} active filters` : 'Choose representations', stage === 'representations'); output.classList.add('flow-output'); canvas.append(output);
    host.append(toolbar, canvas);
    diagramObserver.observe(canvas);
    const recordedCanvas = $('recordedTrace').querySelector('.diagram-canvas');
    if (recordedCanvas && $('traceDisclosure').open) diagramObserver.observe(recordedCanvas);
    // Draw before cloning the completed diagram into the recorded trace.
    connectDiagram(canvas);
  }
  const stageNames = [['features', 'Select features'], ['representations', 'Choose representations']];
  function showStage(stage) {
    const index = stageNames.findIndex(([id]) => id === stage);
    renderDiagram(stage);
    $('liveProgressStatus').textContent = index >= 0 ? stageNames[index][1] + '…' : '';
  }
  form.onsubmit = async event => {
    event.preventDefault();
    let input;
    try { input = readInputs(); } catch (error) { setStatus(error.message, true); return; }
    cancelRun(false);
    const selectedTarget = MARS_TARGETS.find(site => Math.abs(site.lat - input.lat) < 0.00001 && Math.abs(site.lon - input.lon) < 0.00001);
    updateTarget(input.lat, input.lon, selectedTarget?.name ?? 'Custom Mars target');
    if (mode !== 'empty') clearResults();
    $('liveProgress').hidden = false;
    $('searchButton').disabled = true; $('cancel').hidden = false;
    families = { comparisons: [], filters: [] }; recordedTrace = []; plan = { comparisons: [], filters: [], input: undefined }; $('recordedTrace').replaceChildren(); $('traceDisclosure').open = false; showStage(''); $('liveProgressStatus').textContent = 'Connecting…';
    $('liveProgressTitle').focus(); setStatus('Selecting features and representations…');
    const request = new AbortController(); pending = request;
    try {
      const response = await fetch('/api/select/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal,
        body: JSON.stringify({ longitude: input.lon, latitude: input.lat, objective: input.objective }) });
      if (!response.ok) { const data = await response.json(); throw Error(data.detail || 'Selection could not be completed.'); }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', result;
      while (true) {
        const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop();
        if (done && buffer.trim()) lines.push(buffer);
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.stage === 'error') throw Error(event.detail || 'Selection could not be completed.');
          recordedTrace.push(event);
          if (event.stage === 'features_selected') { families = event.families || families; renderDiagram('representations', true); }
          else if (event.stage === 'done') result = event.result;
          else showStage(event.stage);
        }
        if (done) break;
      }
      if (!result) throw Error('Selection ended before a result was returned.');
      await loadMenu(input); if (pending !== request) return;
      plan = { input, comparisons: result.comparisons.map(item => ({ ...item, weight: item.weight })), filters: result.filters };
      balanceWeights(); renderPlan(); renderDiagram('review', true); $('scoreResult').textContent = ''; $('scoreResult').hidden = true; $('scoreStatus').textContent = '';
      $('selectionTarget').textContent = `${input.lat}° N / ${input.lon}° E · ${input.objective}`;
      $('liveProgressStatus').textContent = 'Selection complete · review and edit your plan below.';
      const traceDetails = $('recordedTrace'); const originalDiagram = $('liveStages').cloneNode(true); originalDiagram.removeAttribute('id'); originalDiagram.querySelectorAll('.event-reveal').forEach(node => node.classList.remove('event-reveal')); const rawTrace = el('details'); rawTrace.append(el('summary', 'Raw trace'), el('pre', JSON.stringify(recordedTrace, null, 2), 'trace-record')); traceDetails.replaceChildren(originalDiagram, rawTrace);
      $('liveProgress').hidden = true; $('liveSelection').hidden = false; $('selectionTitle').focus(); setStatus('Selection complete.');
    } catch (error) {
      if (pending === request) { renderDiagram('stopped'); $('liveProgressStatus').textContent = error.message || 'Could not reach the selection service.'; setStatus(error.message, true); }
    } finally {
      if (pending === request) { pending = undefined; $('searchButton').disabled = false; $('cancel').hidden = true; }
    }
  };
  for (const id of ['latitude', 'longitude', 'objective']) {
    const original = $(id).oninput;
    $(id).oninput = event => { if (pending || scoreRequest || !$('liveSelection').hidden) cancelRun(false); original(event); };
  }
})();
