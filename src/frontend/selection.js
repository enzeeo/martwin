(() => {
  const form = $('searchForm');
  let pending, scoreRequest, menu, uplinkAnimation, previewTimer;
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


  /* Choosing representations → Review search. The stage view stays on screen:
     review only folds its log and shows the ledger under the same sky
     (stage-view.js, review-view.css). The ASCII track in the stage heading
     moves between review and stills of the earlier stages. */
  function stopSlide() { document.querySelectorAll('.stage-ghost').forEach(node => node.remove()); }
  function slideToReview() {
    stopSlide();
    $('liveProgress').hidden = false; $('liveSelection').hidden = false;
    StageView.enterReview();
  }
  // Review → a still of features or representations; the ledger steps aside.
  function slideToStages(plane) {
    stopSlide();
    $('liveSelection').hidden = true; $('liveProgress').hidden = false;
    StageView.redraw(plane);
  }
  const reviewReady = () => StageView.setReview(() => slideToReview(), plane => slideToStages(plane));
  cancelRun = function (message = true) {
    stopSlide();
    uplinkAnimation?.cancel(); clearTimeout(previewTimer);
    StageView.stop();
    if (pending) { pending.abort(); pending = undefined; }
    if (scoreRequest) { scoreRequest.abort(); scoreRequest = undefined; $('liveSelection').querySelectorAll('button, input, select').forEach(node => { node.disabled = false; }); $('continents').querySelectorAll('input').forEach(node => { node.disabled = !menu?.continent_filter?.available; }); }
    $('nativeContext')?.remove();
    $('runScore').disabled = false;
    $('liveProgress').hidden = true;
    $('liveProgressStatus').textContent = '';
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
    const available = menu.continent_filter?.available === true; $('continents').querySelectorAll('input').forEach(input => { input.disabled = !available; }); $('continentStatus').textContent = available ? '' : 'Continent masks are unavailable; continent filtering will not be applied.';
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
  /* ---------- review ledger (styles: review-view.css, sky: stage-view.js) ----------
     Features are grouped as in the earlier stages. Each representation row has a
     ‹ name › cycler over its feature's catalog options, an ASCII weight bar that
     works as a slider, a typed percent, details and remove. Weights always
     rebalance to 100 with balanceWeights. */
  const CELLS = 26, EIGHTHS = ' ▏▎▍▌▋▊▉', pad2 = n => String(n).padStart(2, '0'), clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const NUMERIC = ['continuous', 'fraction', 'percentage', 'ordinal', 'count', 'coordinate'];
  let weightViews = [], pop;
  const pct = item => Number.isFinite(item.weight) ? Math.round(item.weight * 100) : 0;
  const scorable = () => plan.comparisons.filter(item => item.score_available);
  const compOptions = id => menu?.comparisons?.find(f => f.feature_id === id)?.options || [];
  const filterOptions = id => id === 'dataset_field' ? menu?.dataset_fields || [] : menu?.filters?.find(f => f.feature_id === id)?.options || [];
  const featureInfo = (kind, id) => (kind === 'comparison' ? families.comparisons : families.filters)?.find(f => f.feature_id === id) || {};
  const featureLabel = (kind, id) => featureInfo(kind, id).label || (id === 'dataset_field' ? 'Earth data fields' : String(id).replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()));
  const repKey = (kind, item) => `${kind}:${item.feature_id}/${item.header}`;
  const button = (text, className, label) => { const b = el('button', text, className); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
  const focusKey = key => $('liveSelection').querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  function groupsOf(kind) {
    const out = [];
    for (const item of kind === 'comparison' ? plan.comparisons : plan.filters) {
      let group = out.find(g => g.id === item.feature_id);
      if (!group) out.push(group = { id: item.feature_id, items: [] });
      group.items.push(item);
    }
    return out;
  }
  const groupTotal = group => group.items.reduce((sum, item) => sum + (item.score_available ? pct(item) : 0), 0);
  function barText(w) {
    const filled = clamp(w, 0, 100) / 100 * CELLS, full = Math.floor(filled), part = Math.round((filled - full) * 8);
    return ['█'.repeat(full) + (part ? EIGHTHS[part] : ''), '·'.repeat(Math.max(0, CELLS - full - (part ? 1 : 0)))];
  }
  function skyGroups() {
    const cs = groupsOf('comparison'), fs = groupsOf('filter');
    return [
      ...cs.map((g, i) => ({ id: 'comparison:' + g.id, kind: 'comparison', num: i + 1, label: featureLabel('comparison', g.id), reps: g.items.map(item => ({ key: repKey('comparison', item), label: item.header, weight: item.score_available ? pct(item) : 0, inactive: !item.score_available })) })),
      ...fs.map((g, i) => ({ id: 'filter:' + g.id, kind: 'filter', num: cs.length + i + 1, label: featureLabel('filter', g.id), reps: g.items.map(item => ({ key: repKey('filter', item), label: item.header, weight: null, inactive: !item.operator })) })),
    ];
  }

  // One small option list at a time, anchored under the control that opened it.
  function closePop(refocus) { if (!pop) return; const { node, back } = pop; pop = undefined; node.remove(); if (refocus) back?.focus(); }
  function openPop(anchor, back, fill) {
    const reopen = pop?.back === back; closePop(); if (reopen) return;
    const node = el('div', undefined, 'rv-pop'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', back.getAttribute('aria-label') || back.textContent);
    fill(node); anchor.append(node); pop = { node, back }; placePop(node, back);
    node.querySelector('input, button:not(:disabled)')?.focus();
  }
  // Lists float over the frame so the scrolling ledger cannot clip them; they open
  // upward when there is no room below their button.
  function placePop(node, anchor) {
    node.style.position = 'fixed'; node.style.top = node.style.left = '0px'; node.style.marginTop = '0';
    const at = anchor.getBoundingClientRect(), frame = ($('liveSelection').closest('.fv-box') || $('liveSelection')).getBoundingClientRect(); // the visible part of a scrolling box
    const height = Math.min(node.scrollHeight, 300), width = node.offsetWidth;
    node.style.maxHeight = '300px';
    const below = Math.min(innerHeight, frame.bottom) - at.bottom - 8, above = at.top - Math.max(0, frame.top) - 8;
    const top = height <= below || below >= above ? at.bottom + 4 : at.top - 4 - Math.min(height, above);
    node.style.maxHeight = `${Math.max(120, height <= below || below >= above ? below : above)}px`;
    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(Math.min(Math.max(8, at.left), innerWidth - width - 8))}px`;
  }
  function placeOpenLists() {
    if (pop) placePop(pop.node, pop.back);
    for (const [toggle, panel] of [['toggleFamily', 'familyMenu'], ['toggleFilter', 'filterMenu']]) if (!$(panel).hidden) placePop($(panel), $(toggle));
  }
  addEventListener('resize', placeOpenLists); // Capture, since the stage box scrolls too; scrolling inside an open list must not move the list.
  document.addEventListener('scroll', event => { if (event.target instanceof Element && event.target.closest('.rv-pop')) return; placeOpenLists(); }, { passive: true, capture: true });
  function optionButtons(node, items, search) {
    const list = el('div'); let input;
    if (search) { input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Search'; input.setAttribute('aria-label', 'Search options'); node.append(input); }
    node.append(list);
    const paint = () => {
      list.replaceChildren(); const term = (input?.value || '').trim().toLowerCase(); let last, any = false;
      for (const item of items) {
        if (term && !`${item.text} ${item.title || ''}`.toLowerCase().includes(term)) continue;
        if (item.group && item.group !== last) { list.append(el('div', item.group, 'rv-grp')); last = item.group; }
        const b = button('', item.kept ? 'kept' : ''); const mark = el('span', item.kept ? '✦' : '·', 'rv-mk'); mark.setAttribute('aria-hidden', 'true'); b.append(mark, el('span', item.text));
        if (item.title) b.title = item.title; if (item.value) b.dataset.value = item.value;
        b.disabled = !!item.disabled; b.onclick = () => { closePop(); item.pick(); }; list.append(b); any = true;
      }
      if (!any) list.append(el('p', term ? 'No matching options' : 'No options available', 'rv-none'));
    };
    input?.addEventListener('input', paint); paint();
  }

  function featHead(kind, group, n) {
    const info = featureInfo(kind, group.id), label = featureLabel(kind, group.id), head = el('div', undefined, 'rv-head');
    const total = el('span', '', 'rv-total'); if (kind === 'comparison') total.dataset.total = group.id;
    const remove = button('×', 'rv-x', `Remove feature ${label}`); remove.dataset.key = `xf:${kind}:${group.id}`;
    remove.onclick = () => {
      if (kind === 'comparison') { plan.comparisons = plan.comparisons.filter(item => item.feature_id !== group.id); balanceWeights(); }
      else plan.filters = plan.filters.filter(item => item.feature_id !== group.id);
      changed(); renderPlan(); $(kind === 'comparison' ? 'toggleFamily' : 'toggleFilter').focus();
    };
    head.append(el('span', pad2(n), 'rv-n'), el('span', kind === 'comparison' ? '✦' : '·', 'rv-star'), el('span', label, 'rv-name'), total,
      el('span', info.phrase ? `from “${info.phrase}”` : info.feature_id ? 'inferred from context' : 'added in review', 'rv-from'), remove);
    return head;
  }
  // ‹ name › steps through the feature's options that are not already in use.
  function cycler(kind, item, options, used, swap) {
    const label = friendly(item), wrap = el('div', undefined, 'rv-cycler'), key = repKey(kind, item);
    const usable = options.filter(o => o.header === item.header || (!used.has(o.header) && (kind === 'filter' || o.score_available)));
    const at = usable.findIndex(o => o.header === item.header), others = usable.some(o => o.header !== item.header);
    const step = d => swap(usable[at < 0 ? (d > 0 ? 0 : usable.length - 1) : (at + d + usable.length) % usable.length]);
    const prev = button('‹', 'rv-step', `Previous representation for ${label}`), next = button('›', 'rv-step', `Next representation for ${label}`);
    prev.disabled = next.disabled = !others; prev.onclick = () => step(-1); next.onclick = () => step(1);
    prev.dataset.key = 'rp:' + key; next.dataset.key = 'rx:' + key;
    const name = button(label, 'rv-rep-name', `${label}: change representation`); name.title = item.header; name.dataset.key = 'rn:' + key; name.setAttribute('aria-haspopup', 'dialog');
    name.onclick = () => openPop(wrap.parentNode, name, node => optionButtons(node, options.map(o => ({
      text: friendly(o), title: o.header, kept: used.has(o.header),
      disabled: (used.has(o.header) && o.header !== item.header) || (kind === 'comparison' && !o.score_available), pick: () => swap(o),
    })), options.length > 8));
    wrap.append(prev, name, next);
    if (kind === 'comparison' && (item.caution || /proxy/i.test(item.scoring_status || ''))) wrap.append(el('span', 'proxy', 'rv-tag'));
    return wrap;
  }
  function addRepButton(kind, group, free, add) {
    const wrap = el('div', undefined, 'rv-add');
    const b = button(`+ ${kind === 'comparison' ? 'representation' : 'condition'} (${free.length} more)`, 'rv-add-btn rv-add-rep');
    b.dataset.key = `ar:${kind}:${group.id}`; b.setAttribute('aria-haspopup', 'dialog');
    b.onclick = () => openPop(wrap, b, node => optionButtons(node, free.map(o => ({ text: friendly(o), title: o.header, pick: () => add(o) })), free.length > 8));
    wrap.append(b); return wrap;
  }

  function comparisonBlock(group, n) {
    const li = el('li', undefined, 'rv-feat comparison'); li.dataset.rf = 'comparison:' + group.id;
    li.append(featHead('comparison', group, n));
    const list = el('ul', undefined, 'rv-reps'), options = compOptions(group.id), used = new Set(group.items.map(item => item.header));
    for (const item of group.items) {
      const row = el('li', undefined, 'rv-rep-row'), key = repKey('comparison', item); row.dataset.rr = key;
      const swap = option => {
        const entry = { ...option, feature_id: item.feature_id, weight: item.weight };
        plan.comparisons[plan.comparisons.indexOf(item)] = entry;
        if (!item.score_available) { const count = scorable().length; entry.weight = count ? 1 / (count + 1) : 1; balanceWeights(entry); }
        changed(); renderPlan(); focusKey('rn:' + repKey('comparison', entry));
      };
      const details = rowDetails(item, [item.header, item.unit, item.meaning, item.definition, item.description, item.reason, item.caution, item.source, item.scoring_status?.replaceAll('_', ' ')]);
      details.button.className = 'rv-info'; details.body.className = 'rv-detail';
      const remove = button('×', 'rv-x', `Remove ${friendly(item)}`); remove.dataset.key = 'x:' + key;
      remove.onclick = () => { plan.comparisons = plan.comparisons.filter(entry => entry !== item); balanceWeights(); changed(); renderPlan(); $('toggleFamily').focus(); };
      row.append(el('span'), cycler('comparison', item, options, used, swap));
      if (item.score_available) {
        const bar = el('span', undefined, 'rv-bar'), fill = el('span', undefined, 'rv-fill'), rest = el('span', undefined, 'rv-rest'); bar.append(fill, rest);
        bar.tabIndex = 0; bar.dataset.key = 'w:' + key;
        for (const [name, value] of [['role', 'slider'], ['aria-label', `Weight bar for ${friendly(item)}`], ['aria-valuemin', '1'], ['aria-valuemax', '100']]) bar.setAttribute(name, value);
        const set = value => { item.weight = clamp(Math.round(value), 1, 100) / 100; balanceWeights(item); refreshWeights(); };
        bar.onkeydown = event => {
          const size = event.shiftKey || event.key.startsWith('Page') ? 10 : 1;
          const delta = { ArrowRight: size, ArrowUp: size, PageUp: size, ArrowLeft: -size, ArrowDown: -size, PageDown: -size }[event.key];
          const to = delta ? pct(item) + delta : event.key === 'Home' ? 1 : event.key === 'End' ? 100 : undefined;
          if (to === undefined || scorable().length < 2) return;
          event.preventDefault(); set(to); changed();
        };
        bar.onpointerdown = event => {
          if (scorable().length < 2 || bar.closest('[inert]') || num.disabled) return;
          event.preventDefault(); bar.setPointerCapture(event.pointerId); bar.focus();
          const at = e => { const box = bar.getBoundingClientRect(); set(clamp((e.clientX - box.left) / box.width, 0, 1) * 100); };
          at(event); bar.onpointermove = at;
          bar.onpointerup = bar.onpointercancel = () => { bar.onpointermove = bar.onpointerup = bar.onpointercancel = null; changed(); };
        };
        const num = document.createElement('input');
        Object.assign(num, { type: 'number', min: '1', max: '100', step: '1', className: 'rv-w' });
        num.setAttribute('aria-label', `Weight for ${friendly(item)}`); num.dataset.key = 'n:' + key;
        num.oninput = () => { item.weight = Number(num.value) / 100; refreshWeights(); changed(); };
        num.onchange = () => { balanceWeights(item); refreshWeights(); };
        weightViews.push({ item, bar, fill, rest, num });
        row.append(bar, num);
      } else row.append(el('span', 'context only · no scoring data', 'rv-context'), el('span'));
      row.append(details.button, remove, details.body); list.append(row);
    }
    li.append(list);
    const free = options.filter(o => !used.has(o.header) && o.score_available);
    if (free.length) li.append(addRepButton('comparison', group, free, option => {
      const count = scorable().length, entry = { ...option, feature_id: group.id, weight: count ? 1 / (count + 1) : 1 };
      plan.comparisons.splice(plan.comparisons.indexOf(group.items.at(-1)) + 1, 0, entry);
      balanceWeights(entry); changed(); renderPlan(); focusKey('n:' + repKey('comparison', entry));
    }));
    return li;
  }

  function filterBlock(group, n) {
    const li = el('li', undefined, 'rv-feat filter'); li.dataset.rf = 'filter:' + group.id;
    li.append(featHead('filter', group, n));
    const list = el('ul', undefined, 'rv-reps'), options = filterOptions(group.id), used = new Set(group.items.map(item => item.header));
    for (const item of group.items) {
      const row = el('li', undefined, `rv-rep-row rv-cond${item.operator ? '' : ' inactive'}`), key = repKey('filter', item); row.dataset.rr = key;
      const swap = option => { const entry = { ...option, feature_id: item.feature_id }; plan.filters[plan.filters.indexOf(item)] = entry; changed(); renderPlan(); focusKey('rn:' + repKey('filter', entry)); };
      const details = rowDetails(item, [item.header, item.unit, item.definition, item.description, item.reason, item.caution, item.source]);
      details.button.className = 'rv-info'; details.body.className = 'rv-detail';
      const remove = button('×', 'rv-x', `Remove ${friendly(item)}`); remove.dataset.key = 'x:' + key;
      remove.onclick = () => { plan.filters = plan.filters.filter(entry => entry !== item); changed(); renderPlan(); $('toggleFilter').focus(); };
      const op = document.createElement('select'); op.className = 'rv-op'; op.setAttribute('aria-label', `Operator for ${friendly(item)}`);
      const numeric = NUMERIC.includes(item.data_type), category = item.data_type === 'categorical', boolean = item.data_type === 'boolean';
      const operators = numeric ? [['>', 'Greater than'], ['>=', 'At least'], ['<', 'Less than'], ['<=', 'At most'], ['==', 'Equals'], ['!=', 'Does not equal'], ['between', 'Between']] : category ? [['==', 'Is'], ['!=', 'Is not'], ['in', 'Is one of']] : boolean ? [['==', 'Is']] : [];
      for (const [value, label] of [['', 'Suggested · inactive'], ...operators, ['has_data', 'Has data'], ['missing', 'Missing']]) { const option = el('option', label); option.value = value; op.append(option); }
      op.value = item.operator || ''; op.disabled = item.filter_available === false;
      const choiceSearch = document.createElement('input'); choiceSearch.type = 'search'; choiceSearch.placeholder = 'Search choices'; choiceSearch.setAttribute('aria-label', `Search choices for ${friendly(item)}`); choiceSearch.hidden = true;
      const value = document.createElement(numeric ? 'input' : 'select'); value.setAttribute('aria-label', `Value for ${friendly(item)}`);
      const and = el('span', 'and');
      const max = document.createElement('input'); Object.assign(max, { type: 'number', step: 'any', placeholder: 'max', value: item.value_max === undefined ? '' : item.value_max * (item.display_scale || 1) }); max.setAttribute('aria-label', `Maximum for ${friendly(item)}`);
      if (numeric) Object.assign(value, { type: 'number', step: 'any', placeholder: 'value', value: item.value === undefined ? '' : item.value * (item.display_scale || 1) });
      else if (boolean) { for (const [v, label] of [['', 'Choose'], ['true', 'Yes'], ['false', 'No']]) { const o = el('option', label); o.value = v; value.append(o); } value.value = item.value === undefined ? '' : String(item.value); }
      else if (category) { const placeholder = el('option', 'Choose'); placeholder.value = ''; value.append(placeholder); for (const choice of item.choices || []) { const o = el('option', choice.label); o.value = choice.value; value.append(o); } }
      choiceSearch.oninput = () => { const term = choiceSearch.value.toLowerCase(); for (const option of value.options) option.hidden = !!option.value && !option.textContent.toLowerCase().includes(term); };
      const unit = el('span', item.display_unit || item.unit || '', 'filter-unit');
      const refresh = () => { row.classList.toggle('inactive', !item.operator); StageView.review(skyGroups()); renderSentence(); };
      const sync = () => { value.hidden = !op.value || ['has_data', 'missing'].includes(op.value); choiceSearch.hidden = !category || value.hidden; unit.hidden = !numeric || value.hidden; max.hidden = and.hidden = op.value !== 'between'; if (category) { value.multiple = op.value === 'in'; for (const option of value.options) option.selected = Array.isArray(item.value) ? item.value.includes(option.value) : option.value === item.value; } };
      op.onchange = () => { item.operator = op.value || undefined; item.value = undefined; value.value = ''; sync(); changed(); refresh(); };
      value.onchange = value.oninput = () => { renderSentenceSoon(); if (numeric) item.value = value.value === '' ? undefined : Number(value.value) / (item.display_scale || 1); else if (boolean) item.value = value.value === '' ? undefined : value.value === 'true'; else item.value = value.multiple ? [...value.selectedOptions].map(option => option.value).filter(Boolean) : value.value || undefined; changed(); };
      max.oninput = () => { renderSentenceSoon(); item.value_max = max.value === '' ? undefined : Number(max.value) / (item.display_scale || 1); changed(); };
      sync();
      const vals = el('div', undefined, 'rv-vals'); vals.append(choiceSearch, value, and, max, unit);
      if (item.filter_available === false) vals.append(el('span', 'unavailable in the prepared Earth data', 'rv-context'));
      row.append(el('span'), cycler('filter', item, options, used, swap), op, vals, details.button, remove, details.body); list.append(row);
    }
    li.append(list);
    const free = options.filter(o => !used.has(o.header));
    if (free.length) li.append(addRepButton('filter', group, free, option => {
      const entry = { ...option, feature_id: group.id };
      plan.filters.splice(plan.filters.indexOf(group.items.at(-1)) + 1, 0, entry);
      changed(); renderPlan(); focusKey('rn:' + repKey('filter', entry));
    }));
    return li;
  }

  // Weight-only refresh: bars, typed values, subtotals, budget, sky and recap. Keeps focus and drags.
  function refreshWeights() {
    const items = scorable(), many = items.length > 1;
    for (const view of weightViews) {
      const w = pct(view.item), [filled, rest] = barText(w);
      view.fill.textContent = filled; view.rest.textContent = rest;
      view.bar.setAttribute('aria-valuenow', String(w)); view.bar.setAttribute('aria-valuetext', `${w} percent`); view.bar.setAttribute('aria-disabled', String(!many));
      if (document.activeElement !== view.num) view.num.value = Number.isFinite(view.item.weight) ? String(w) : '';
    }
    const groups = groupsOf('comparison');
    for (const group of groups) { const node = $('comparisons').querySelector(`[data-total="${CSS.escape(group.id)}"]`); if (node) node.textContent = group.items.some(item => item.score_available) ? `Σ ${groupTotal(group)}` : ''; }
    const sum = items.reduce((total, item) => total + pct(item), 0);
    $('weightSum').textContent = items.length ? `Σ ${sum}` : ''; $('weightSum').classList.toggle('bad', items.length > 0 && sum !== 100);
    $('liveSelection').classList.toggle('rv-ready', items.length > 0 && sum === 100 && plan.comparisons.every(item => item.score_available));
    StageView.review(skyGroups()); renderSentence();
  }
  // The recap reads as three lines: what to compare, which conditions must hold, and where to look.
  // Each item keeps its own star (✦ compare, ◇ filter), so no separator is needed between them.
  const OP_TEXT = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '==': '=', '!=': '≠', between: 'between', in: 'is one of', has_data: 'has data', missing: 'is missing' };
  function conditionText(item) {
    const name = friendly(item).toLowerCase(), scale = item.display_scale || 1, unit = item.display_unit || item.unit || '';
    const show = v => typeof v === 'number' ? `${Number((v * scale).toPrecision(4))}${unit && unit.length <= 3 ? ' ' + unit : ''}` : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v ?? '…';
    if (item.operator === 'has_data' || item.operator === 'missing') return `${name} ${OP_TEXT[item.operator]}`;
    if (item.operator === 'between') return `${name} between ${show(item.value)} and ${show(item.value_max)}`;
    return `${name} ${OP_TEXT[item.operator] || item.operator} ${show(item.value)}`;
  }
  const renderSentenceSoon = () => queueMicrotask(renderSentence); // after the handler stores the value
  function renderSentence() {
    const node = $('reviewSentence'); node.replaceChildren();
    const line = lead => { if (lead) node.append(el('span', lead, 'rv-row rv-lead')); const row = el('span', undefined, 'rv-row'); node.append(row); return row; };
    const groups = groupsOf('comparison').map(group => ({ label: featureLabel('comparison', group.id), total: groupTotal(group) })).sort((a, b) => b.total - a.total);
    if (!groups.length) line().append('Add a feature to compare, then search');
    else { const row = line('Find Earth cells like'); for (const group of groups) row.append(el('b', `✦ ${group.label.toLowerCase()} ${group.total}`, 'c rv-item')); }
    const active = plan.filters.filter(item => item.operator);
    const row = line('where');
    if (active.length) for (const item of active) row.append(el('b', `◇ ${conditionText(item)}`, 'f rv-item'));
    else row.append(el('span', 'no active Earth filters', 'rv-none-yet'));
  }

  function renderPlan() {
    closePop(); weightViews = [];
    const comparisons = $('comparisons'), filters = $('filters'), cgroups = groupsOf('comparison'), fgroups = groupsOf('filter');
    comparisons.replaceChildren(); filters.replaceChildren();
    if (!cgroups.length) comparisons.append(el('li', 'Add a feature to compare.', 'rv-empty'));
    cgroups.forEach((group, i) => comparisons.append(comparisonBlock(group, i + 1)));
    if (!fgroups.length) filters.append(el('li', 'No Earth filter fields selected.', 'rv-empty'));
    fgroups.forEach((group, i) => filters.append(filterBlock(group, cgroups.length + i + 1)));
    renderFeatureOptions(); renderFilterOptions();
    refreshWeights();
  }
  function menuButtons(list, items, emptyText) {
    list.replaceChildren(); let last;
    for (const item of items) {
      if (item.group && item.group !== last) { list.append(el('div', item.group, 'rv-grp')); last = item.group; }
      const b = button('', item.kept ? 'kept' : ''), mark = el('span', item.kept ? '✦' : '·', 'rv-mk'), text = el('span', undefined, 'rv-opt');
      mark.setAttribute('aria-hidden', 'true'); text.append(el('span', item.text, 'rv-opt-name'));
      if (item.meta) text.append(el('span', item.meta, 'rv-opt-meta'));
      b.append(mark, text); if (item.title) b.title = item.title; b.dataset.value = item.value; b.disabled = !!item.disabled; b.onclick = item.pick; list.append(b);
    }
    if (!items.length) list.append(el('p', emptyText, 'rv-none'));
  }
  const byGroup = (a, b) => a.group.localeCompare(b.group, 'en', { sensitivity: 'base' }) || a.text.localeCompare(b.text, 'en', { sensitivity: 'base', numeric: true });
  function closeMenu(id) { const toggle = id === 'familyMenu' ? 'toggleFamily' : 'toggleFilter'; $(id).hidden = true; $(toggle).setAttribute('aria-expanded', 'false'); $(toggle).focus(); }
  // Every comparison feature in the catalog. Picking one adds it with its first
  // scorable representation; ‹ › on its row then changes or adds representations.
  function renderFeatureOptions() {
    const inPlan = new Set(plan.comparisons.map(item => item.feature_id)), term = $('featureSearch').value.trim().toLowerCase();
    const items = (menu?.comparisons || []).map(family => ({ family, options: family.options.filter(option => option.score_available), label: featureLabel('comparison', family.feature_id) }))
      .filter(({ family, options, label }) => options.length && [label, family.feature_id, family.description, ...options.flatMap(option => [friendly(option), option.header])].join(' ').toLowerCase().includes(term))
      .map(({ family, options, label }) => {
        const added = inPlan.has(family.feature_id), count = options.length;
        return {
          group: added ? 'Already in your search' : 'Add a feature', text: label, value: family.feature_id, title: family.description, kept: added, disabled: added,
          meta: added ? 'change or add representations from its row' : `${count} representation${count > 1 ? 's' : ''} · starts with ${friendly(options[0])}`,
          pick: () => {
            const total = scorable().length, entry = { ...options[0], feature_id: family.feature_id, weight: total ? 1 / (total + 1) : 1 };
            plan.comparisons.push(entry); balanceWeights(entry); changed(); renderPlan(); closeMenu('familyMenu'); focusKey('rn:' + repKey('comparison', entry));
          },
        };
      })
      .sort((a, b) => a.kept - b.kept || a.text.localeCompare(b.text, 'en', { sensitivity: 'base', numeric: true }));
    menuButtons($('addFamily'), items, term ? 'No matching features' : 'No features available');
  }
  function renderFilterOptions() {
    const chosen = new Set(plan.filters.map(item => `${item.feature_id}/${item.header}`)), term = $('filterSearch').value.trim().toLowerCase();
    const all = [...(menu?.filters || []).flatMap(family => family.options.map(option => ({ ...option, feature_id: family.feature_id }))), ...(menu?.dataset_fields || []).map(option => ({ ...option, feature_id: 'dataset_field' }))];
    const items = all.filter(option => !chosen.has(`${option.feature_id}/${option.header}`) && `${friendly(option)} ${option.header}`.toLowerCase().includes(term))
      .map(option => ({ group: featureLabel('filter', option.feature_id), text: `${friendly(option)}${option.filter_available === false ? ' · unavailable' : ''}`, title: option.header, value: `${option.feature_id}/${option.header}`, pick: () => {
        const last = plan.filters.findLastIndex(item => item.feature_id === option.feature_id);
        if (last >= 0) plan.filters.splice(last + 1, 0, option); else plan.filters.push(option);
        changed(); renderPlan(); closeMenu('filterMenu');
      } })).sort(byGroup);
    menuButtons($('addFilter'), items, term ? 'No matching filters' : 'No filters available');
  }
  const continents = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];
  for (const name of continents) { const label = el('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = name; input.checked = true; input.onchange = () => { changed(); }; label.append(input, document.createTextNode(name)); $('continents').append(label); }
  $('resultLimit').oninput = changed; $('separation').oninput = changed;
  for (const [toggle, panel, search] of [['toggleFamily', 'familyMenu', 'featureSearch'], ['toggleFilter', 'filterMenu', 'filterSearch']]) $(toggle).onclick = () => {
    const open = $(panel).hidden; closePop();
    $(panel).hidden = !open; $(toggle).setAttribute('aria-expanded', String(open));
    if (open) { $(search).value = ''; if (search === 'featureSearch') renderFeatureOptions(); else renderFilterOptions(); placePop($(panel), $(toggle)); $(search).focus(); }
  };
  $('featureSearch').oninput = () => { renderFeatureOptions(); placePop($('familyMenu'), $('toggleFamily')); };
  $('filterSearch').oninput = () => { renderFilterOptions(); placePop($('filterMenu'), $('toggleFilter')); };
  $('liveSelection').querySelector('.rv-ledger').addEventListener('scroll', placeOpenLists, { passive: true });
  StageView.link($('stageDeck'));
  document.addEventListener('pointerdown', event => {
    if (pop && !pop.node.contains(event.target) && event.target !== pop.back) closePop();
    for (const [toggle, panel] of [['toggleFamily', 'familyMenu'], ['toggleFilter', 'filterMenu']]) if (!$(panel).hidden && !$(panel).parentNode.contains(event.target)) { $(panel).hidden = true; $(toggle).setAttribute('aria-expanded', 'false'); }
  });
  $('liveSelection').addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (pop) { event.preventDefault(); closePop(true); return; }
    for (const panel of ['familyMenu', 'filterMenu']) if (!$(panel).hidden) { event.preventDefault(); closeMenu(panel); }
  });
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
        selectedId = null; renderLocations();
        setPlanet('earth');
        $('listHeading').textContent = 'Ranked Earth locations';
        $('listDescription').textContent = 'Locations scored using your reviewed representations and weights.';
        $('mapStatus').textContent = `${data.ranked.length} of ${result_count} requested · minimum separation ${min_separation_km} km`; fitAsciiEarth(locations);
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
    // Connecting, selecting features and choosing representations use the star view.
    // Review keeps the diagram, which the plan below still edits, in a hidden holder:
    // it is only shown inside the selection trace, and the stars stay to come back to.
    // A stopped run shows it in place of the stars.
    if (stage === '' || stage === 'features' || stage === 'representations') { StageView.show(stage === 'representations' && reveal ? 'selected' : stage, families); return; }
    StageView.stop();
    const host = stage === 'review' ? $('reviewDiagram') : $('liveStages'), running = ['features', 'representations'].includes(stage);
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
  const previewFamilies = { comparisons: [
    { feature_id: 'terrain', label: 'Terrain shape', phrase: 'field-testing', description: 'Slope, relief and roughness inside one 5 km cell.' },
    { feature_id: 'surface', label: 'Surface properties', phrase: 'subsurface ice', description: 'Near-surface ice and surface reflectance, with caveats about differing sources.' }
  ], filters: [{ feature_id: 'climate', label: 'Climate', description: 'Earth-only temperature and moisture climatology.' }] };
  const previewComparisons = [
    { feature_id: 'terrain', header: 'slope', label: 'Mean terrain slope', unit: '°', score_available: true, weight: .6 },
    { feature_id: 'surface', header: 'albedo', label: 'Surface albedo', score_available: true, weight: .4 }
  ];
  const previewFilters = [{ feature_id: 'climate', header: 'temperature', label: 'Mean temperature', unit: '°C', data_type: 'continuous', filter_available: true }];
  // Well-known Mars analog field sites; ranks and distances are made up for the preview.
  const previewMenu = { comparisons: [
    { feature_id: 'terrain', options: [['slope', 'Mean terrain slope'], ['slope_p90', '90th percentile slope'], ['slope_frac_gt_5', 'Area steeper than 5°'], ['relief', 'Local relief'], ['tri_p50', 'Median terrain ruggedness']].map(([header, label]) => ({ header, label })) },
    { feature_id: 'surface', options: [['albedo', 'Surface albedo'], ['ice_frac', 'Ice coverage'], ['ti_pct', 'Thermal inertia percentile']].map(([header, label]) => ({ header, label })) },
    // Not chosen in the sample run; they show up under + add feature in the review preview.
    { feature_id: 'wind', description: 'Near-surface wind speed statistics.', options: [['wind_mean_ms', 'Mean wind speed'], ['wind_max_ms', 'Maximum wind speed']].map(([header, label]) => ({ header, label })) },
    { feature_id: 'dunes', description: 'Dune coverage and distance to dune fields.', options: [['dune_frac', 'Dune coverage'], ['dist_dune_km', 'Distance to dunes']].map(([header, label]) => ({ header, label })) },
    { feature_id: 'surface_temperature', description: 'Surface temperature range across the day and year.', options: [['tsurf_min_K', 'Minimum surface temperature'], ['tsurf_diurnal_K', 'Daily temperature swing']].map(([header, label]) => ({ header, label })) }
  ], filters: [
    { feature_id: 'climate', options: [['temperature', 'Mean temperature'], ['tsurf_min_K', 'Minimum surface temperature'], ['h2o_col', 'Column water vapour']].map(([header, label]) => ({ header, label })) }
  ] };
  const previewAnswer = () => ({
    comparisons: previewComparisons.map(item => ({ ...item, reason: 'Sample reason: the statistic that most directly addresses the stated need.' })),
    filters: previewFilters.map(item => ({ ...item, reason: 'Sample reason: an Earth-only constraint named in the question.' }))
  });
  const previewMatches = [
    ['sample_atacama_yungay', -24.08, -70.02, 3, 'Atacama Desert, Yungay'],
    ['sample_dry_valleys', -77.47, 161.77, 186, 'McMurdo Dry Valleys'],
    ['sample_haughton_crater', 75.38, -89.68, 210, 'Haughton crater, Devon Island'],
    ['sample_rio_tinto', 37.72, -6.56, 290, 'Río Tinto'],
    ['sample_utah_mdrs', 38.41, -110.79, 1390, 'San Rafael Swell, Utah'],
  ];
  function previewResults() {
    mode = 'live'; recorded = { run_id: 'stage preview', revision: 'sample data' };
    locations = previewMatches.map(([id, lat, lon, elevation_m, name], index) => ({
      name, region_id: id, lat, lon, elevation_m, rank: index + 1, marker: index + 1, environment: 'unspecified',
      score: Number((0.12 + index * 0.07).toFixed(4)),
      group_distances: { slope: Number((0.08 + index * 0.05).toFixed(4)), albedo: Number((0.15 + index * 0.04).toFixed(4)) },
      group_contributions: { slope: 0.6, albedo: 0.4 },
    }));
    window.resultFeatureLabels = { slope: 'Mean terrain slope', albedo: 'Surface albedo' };
    selectedId = null; renderLocations();
    setPlanet('earth');
    $('listHeading').textContent = 'Ranked Earth locations';
    $('listDescription').textContent = 'Sample matches for previewing the layout. No scoring was run.';
    $('mapStatus').textContent = `Sample data · ${locations.length} example analog sites, not real scores`;
    fitAsciiEarth(locations);
  }
  function previewStage(stage) {
    clearTimeout(previewTimer);
    if (mode === 'live' && stage !== 'results') clearResults();
    const reviewed = stage === 'review' || stage === 'results';
    families = stage === 'connecting' || stage === 'features' ? { comparisons: [], filters: [] } : previewFamilies;
    if (reviewed) {
      // The sample run, already decided, so Features and Representations stay one tab away.
      StageView.begin({ question: $('objective').value, lat: $('latitude').value, lon: $('longitude').value, sample: true });
      StageView.setCatalog(previewMenu); StageView.show('representations', previewFamilies); StageView.settle(previewAnswer()); reviewReady();
      slideToReview();
    } else { stopSlide(); $('liveProgress').hidden = false; $('liveSelection').hidden = true; }
    if (reviewed) {
      menu = { comparisons: previewMenu.comparisons.map(f => ({ ...f, options: f.options.map(o => ({ ...o, score_available: true })) })), filters: previewMenu.filters.map(f => ({ ...f, options: f.options.map(o => ({ ...o, data_type: 'continuous', filter_available: true })) })), dataset_fields: [], continent_filter: { available: false } };
      plan = { comparisons: previewComparisons.map(item => ({ ...item })), filters: previewFilters.map(item => ({ ...item })) };
      renderPlan(); renderDiagram('review');
      $('selectionTarget').textContent = '18.4446° N / 77.4509° E · Sample research question';
      $('recordedTrace').replaceChildren($('reviewDiagram').cloneNode(true));
      $('recordedTrace').firstChild.removeAttribute('id'); $('recordedTrace').firstChild.hidden = false;
      $('traceDisclosure').open = false;
      $('scoreStatus').textContent = 'Preview only · scoring is disabled.';
      $('runScore').disabled = true;
      if (stage === 'results') { previewResults(); $('scoreStatus').textContent = 'Preview only · sample matches shown on the map below.'; }
    } else {
      $('runScore').disabled = false;
      StageView.begin({ question: $('objective').value, lat: $('latitude').value, lon: $('longitude').value, sample: true });
      if (stage === 'representations') {
        StageView.setCatalog(previewMenu);
        previewTimer = setTimeout(() => StageView.resolve(previewAnswer()), 9000); // sample answer, replayed
      }
      showStage(stage === 'connecting' ? '' : stage);
      $('liveProgressStatus').textContent = stage === 'connecting' ? 'Connecting…' : stageNames.find(([id]) => id === stage)[1] + '…';
    }
  }
  $('testLoading').onclick = () => {
    cancelRun(false);
    previewStage('features');
    $('liveProgress').scrollIntoView({ behavior: 'instant', block: 'start' });
    setStatus('Stage preview: no search was sent.');
  };
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
    families = { comparisons: [], filters: [] }; recordedTrace = []; plan = { comparisons: [], filters: [], input: undefined }; $('recordedTrace').replaceChildren(); $('traceDisclosure').open = false; StageView.begin({ question: input.objective, lat: input.lat, lon: input.lon }); showStage(''); $('liveProgressStatus').textContent = 'Connecting…';
    const progressTitle = $('liveProgressTitle');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progressTitle.focus();
    } else {
      progressTitle.focus({ preventScroll: true });
      uplinkAnimation = $('uplinkPacket').animate([
        { left: '0', opacity: 1 },
        { left: 'calc(100% - 7px)', opacity: 1, offset: 0.82 },
        { left: 'calc(100% - 7px)', opacity: 0, transform: 'translateY(10px)' }
      ], { duration: 520, easing: 'linear' });
      uplinkAnimation.onfinish = () => {
        if (document.activeElement === progressTitle && !$('liveProgress').hidden) {
          StageView.reveal(); // slide down to the question and the log
        }
      };
    }
    setStatus('Selecting features and representations…');
    const request = new AbortController(); pending = request;
    // The catalog lists every candidate representation; load it alongside the stream.
    const menuLoad = loadMenu(input);
    menuLoad.then(() => { if (pending === request) StageView.setCatalog(menu); }, () => {});
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
      await menuLoad; if (pending !== request) return;
      // Replay the model's choices in the order it wrote them, then review.
      await StageView.resolve(result); if (pending !== request) return;
      plan = { input, comparisons: result.comparisons.map(item => ({ ...item, weight: item.weight })), filters: result.filters };
      balanceWeights(); renderPlan(); renderDiagram('review', true); $('scoreResult').textContent = ''; $('scoreResult').hidden = true; $('scoreStatus').textContent = '';
      $('selectionTarget').textContent = `${input.lat}° N / ${input.lon}° E · ${input.objective}`;
      $('liveProgressStatus').textContent = 'Selection complete · review and edit your plan below.';
      const traceDetails = $('recordedTrace'); const originalDiagram = $('reviewDiagram').cloneNode(true); originalDiagram.removeAttribute('id'); originalDiagram.hidden = false; originalDiagram.querySelectorAll('.event-reveal').forEach(node => node.classList.remove('event-reveal')); const rawTrace = el('details'); rawTrace.append(el('summary', 'Raw trace'), el('pre', JSON.stringify(recordedTrace, null, 2), 'trace-record')); traceDetails.replaceChildren(originalDiagram, rawTrace);
      reviewReady(); slideToReview(); $('selectionTitle').focus({ preventScroll: true }); setStatus('Selection complete.');
    } catch (error) {
      if (pending === request) { renderDiagram('stopped'); $('liveProgressStatus').textContent = error.message || 'Could not reach the selection service.'; setStatus(error.message, true); }
    } finally {
      if (pending === request) { pending = undefined; $('searchButton').disabled = false; $('cancel').hidden = true; }
    }
  };
  for (const id of ['latitude', 'longitude', 'objective']) {
    const original = $(id).oninput;
    $(id).oninput = event => { if (pending || scoreRequest || !$('liveProgress').hidden || !$('liveSelection').hidden) cancelRun(false); original(event); };
  }
})();
