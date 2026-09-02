export function renderPlanningPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="ProductWoc 把想法变成可执行的产品计划" />
  <meta property="og:title" content="ProductWoc" />
  <meta property="og:description" content="把想法变成可执行的产品计划" />
  <meta property="og:image" content="http://127.0.0.1:4173/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="http://127.0.0.1:4173/og.png" />
  <title>ProductWoc · 产品规划工作台</title>
  <style>
    :root { color-scheme:light; --ink:#15211b; --muted:#657169; --line:#dce3dd; --paper:#f5f7f2; --card:#fff; --green:#1f6b4f; --dark:#13271f; --lime:#dff29d; --amber:#f4b860; --red:#a33b32; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; color:var(--ink); background:var(--paper); font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button,input,textarea { font:inherit; }
    button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible { outline:3px solid #79a9ff; outline-offset:3px; }
    .skip { position:fixed; left:12px; top:-60px; z-index:20; padding:10px 14px; border-radius:8px; background:white; color:var(--ink); }
    .skip:focus { top:12px; }
    .shell { min-height:100vh; display:grid; grid-template-columns:248px 1fr; }
    .rail { padding:28px 20px; background:var(--dark); color:#eef5ef; display:flex; flex-direction:column; gap:32px; }
    .brand { display:flex; gap:11px; align-items:center; font-weight:760; letter-spacing:-.02em; }
    .mark { width:34px; height:34px; display:grid; place-items:center; border-radius:11px; background:var(--lime); color:#183b2c; font-weight:900; }
    .eyebrow { color:#97a69e; font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
    .steps { display:grid; gap:8px; }
    .step { display:grid; grid-template-columns:24px 1fr; gap:10px; align-items:start; padding:10px; border-radius:12px; color:#9fb0a7; }
    .step strong { display:block; font-size:13px; } .step small { display:block; margin-top:2px; }
    .step.done { color:#c7d7ce; } .step.active { color:#fff; background:#244638; }
    .dot { width:20px; height:20px; border:1px solid currentColor; border-radius:50%; display:grid; place-items:center; font-size:10px; }
    .active .dot { background:var(--lime); border-color:var(--lime); color:#173829; }
    .local { margin-top:auto; padding:13px; border:1px solid #355747; border-radius:14px; color:#bad0c3; font-size:12px; }
    main { padding:36px clamp(24px,5vw,72px) 64px; max-width:1440px; width:100%; }
    .topline { display:flex; align-items:center; justify-content:space-between; gap:20px; }
    .crumb,.muted { color:var(--muted); } .crumb { font-size:13px; }
    .status { display:inline-flex; align-items:center; gap:8px; padding:7px 11px; border:1px solid #bfd5c7; border-radius:999px; background:#eff8f1; color:#205d45; font-weight:650; font-size:12px; }
    .status::before { content:""; width:7px; height:7px; border-radius:50%; background:#2d8b62; }
    h1 { margin:28px 0 8px; max-width:850px; font-size:clamp(34px,5vw,58px); line-height:1.04; letter-spacing:-.05em; }
    .lede { max-width:760px; margin:0; color:var(--muted); font-size:17px; }
    .meta { display:flex; flex-wrap:wrap; gap:9px; margin:22px 0 30px; }
    .pill { padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:#fff; color:#536158; font-size:12px; }
    .grid { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(300px,.8fr); gap:22px; align-items:start; }
    .stack,.doc-grid { display:grid; gap:18px; } .doc-grid { grid-template-columns:repeat(3,1fr); margin:22px 0; }
    .card { border:1px solid var(--line); border-radius:20px; background:var(--card); box-shadow:0 14px 40px rgba(26,48,36,.055); overflow:hidden; }
    .card-head { padding:20px 22px 0; display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .card h2,.card h3 { margin:0; letter-spacing:-.02em; } .card h2 { font-size:18px; } .card h3 { font-size:16px; }
    .card p { color:var(--muted); } .card-body { padding:18px 22px 22px; }
    .doc { min-height:190px; display:flex; flex-direction:column; } .doc .card-body { flex:1; display:flex; flex-direction:column; }
    .doc button { margin-top:auto; align-self:start; }
    .scope { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .scope-box { padding:16px; border-radius:14px; background:#f4f7f3; } .scope-box.out { background:#faf5ed; }
    .scope-box h3 { margin:0 0 10px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
    ul { margin:0; padding-left:19px; } li + li { margin-top:7px; }
    .risk { border-left:3px solid var(--amber); padding:10px 12px; background:#fff9ef; border-radius:0 10px 10px 0; color:#765322; }
    .approval { position:sticky; top:24px; } .approval .card-body { display:grid; gap:16px; }
    .metric { display:grid; grid-template-columns:1fr auto; gap:10px; padding-bottom:13px; border-bottom:1px solid var(--line); }
    .metric strong { font-size:26px; line-height:1; letter-spacing:-.04em; }
    .actions { display:grid; gap:9px; }
    button { cursor:pointer; } button:disabled { cursor:not-allowed; opacity:.5; }
    .primary,.secondary,.danger { border-radius:12px; padding:11px 16px; font-weight:700; }
    .primary { border:0; background:var(--green); color:white; } .secondary { border:1px solid var(--line); background:white; color:var(--ink); }
    .danger { border:1px solid #e8c5c2; background:#fff7f6; color:var(--red); }
    .hint { margin:0; font-size:12px; color:var(--muted); }
    .start { max-width:740px; margin-top:34px; } .start label { display:block; margin:14px 0 6px; font-weight:700; }
    .start input,.start textarea { width:100%; padding:12px 14px; border:1px solid #bcc8c0; border-radius:12px; background:white; }
    .start textarea { min-height:140px; resize:vertical; } .start button { margin-top:16px; }
    .notice { padding:12px 14px; border-radius:12px; background:#fff7e9; color:#6f4d18; }
    dialog { width:min(900px,calc(100% - 32px)); max-height:85vh; border:0; border-radius:20px; padding:0; box-shadow:0 30px 90px #0e221a55; }
    dialog::backdrop { background:#10241dbb; } .dialog-head { position:sticky; top:0; background:white; display:flex; justify-content:space-between; gap:16px; padding:18px 22px; border-bottom:1px solid var(--line); }
    pre { margin:0; padding:24px; white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .busy { opacity:.62; pointer-events:none; }
    @media (max-width:1000px) { .doc-grid { grid-template-columns:1fr; } }
    @media (max-width:900px) { .shell { grid-template-columns:1fr; } .rail { padding:18px; } .steps { grid-template-columns:repeat(4,1fr); } .step { grid-template-columns:1fr; } .step small,.eyebrow,.local { display:none; } .grid { grid-template-columns:1fr; } .approval { position:static; } }
    @media (max-width:580px) { main { padding:24px 16px 44px; } .steps { overflow:auto; grid-template-columns:repeat(4,minmax(125px,1fr)); } .scope { grid-template-columns:1fr; } h1 { font-size:36px; } .topline { align-items:flex-start; flex-direction:column; } }
    @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
  </style>
</head>
<body>
  <a class="skip" href="#main">跳到主要内容</a>
  <div class="shell">
    <aside class="rail" aria-label="规划阶段"><div class="brand"><span class="mark">W</span><span>ProductWoc</span></div><div><div class="eyebrow">Planning workflow</div><nav class="steps" id="steps"></nav></div><div class="local">本地独立模式<br/>数据仅保存在当前设备</div></aside>
    <main id="main"><div id="app" aria-live="polite"></div></main>
  </div>
  <dialog id="document-dialog" aria-labelledby="dialog-title"><div class="dialog-head"><strong id="dialog-title">完整文档</strong><button class="secondary" id="close-dialog" type="button">关闭</button></div><pre id="document-content"></pre></dialog>
  <script>
    (function () {
      var app = document.getElementById('app');
      var steps = document.getElementById('steps');
      var dialog = document.getElementById('document-dialog');
      var projectId = localStorage.getItem('productwoc.projectId') || 'demo-project';
      var currentView = null;
      function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
      function list(items) { return '<ul>' + (items && items.length ? items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') : '<li class="muted">暂无</li>') + '</ul>'; }
      function requestKey(action) { return action + ':' + Date.now() + ':' + Math.random().toString(36).slice(2); }
      function developmentUrl() { var target = new URL(window.location.href); target.port = '4273'; target.pathname = '/'; target.search = '?projectId=' + encodeURIComponent(projectId); target.hash = ''; return target.toString(); }
      function setBusy(value) { document.body.classList.toggle('busy', value); }
      function renderSteps(timeline) { steps.innerHTML = (timeline || [{stage:'discovery',label:'需求理解',state:'active'},{stage:'project_spec',label:'产品规格',state:'pending'},{stage:'technical_design',label:'技术设计',state:'pending'},{stage:'execution_plan',label:'执行计划',state:'pending'}]).map(function (item, index) { var mark = item.state === 'done' ? '✓' : String(index + 1); return '<div class="step ' + esc(item.state) + '"><span class="dot">' + mark + '</span><span><strong>' + esc(item.label) + '</strong><small>' + (item.state === 'done' ? '已完成' : item.state === 'active' ? '当前阶段' : '尚未开始') + '</small></span></div>'; }).join(''); }
      function renderStart(message) { currentView = null; renderSteps(); app.innerHTML = '<div class="topline"><div class="crumb">本地工作区 / 新规划</div><span class="status">独立运行</span></div><h1>把产品想法，变成可执行的计划。</h1><p class="lede">ProductWoc 会依次生成产品规格、技术设计和执行计划；每个关键版本都需要你明确确认。</p>' + (message ? '<p class="notice">' + esc(message) + '</p>' : '') + '<form class="card start" id="start-form"><div class="card-body"><label for="project-id">项目标识</label><input id="project-id" name="projectId" value="' + esc(projectId) + '" pattern="[A-Za-z0-9._:-]+" required/><label for="idea">产品想法</label><textarea id="idea" name="idea" required minlength="3" placeholder="例如：为小团队创建一个私有的客户反馈管理工具">为小团队创建一个私有的客户反馈管理工具，可以记录反馈和处理状态。</textarea><button class="primary" type="submit">开始规划</button></div></form>'; document.getElementById('start-form').addEventListener('submit', start); }
      function docCard(subject, label) { var doc = currentView.documents.find(function (item) { return item.subject === subject; }); if (!doc) return '<article class="card doc"><div class="card-head"><h3>' + label + '</h3><span class="pill">待生成</span></div><div class="card-body"><p>完成上一阶段确认后自动生成。</p></div></article>'; var summary = doc.summary.goal || doc.summary.architecture || doc.summary.summary || ''; var latestDiff = doc.versions[doc.versions.length - 1].structuredDiff.length; return '<article class="card doc"><div class="card-head"><h3>' + esc(label) + '</h3><span class="pill">v' + doc.version + (doc.approved ? ' · 已确认' : ' · 待确认') + '</span></div><div class="card-body"><p>' + esc(summary) + '</p><p class="hint">版本 · ' + doc.versions.map(function (item) { return 'v' + item.version; }).join(' → ') + (doc.versions.length > 1 ? ' · 最新 Diff ' + latestDiff + ' 项' : '') + '</p><p class="hint">Hash · ' + esc(doc.hash.slice(0,12)) + '…</p><button class="secondary view-document" data-subject="' + subject + '" type="button">查看全文与 Diff</button></div></article>'; }
      function currentDocument() { return currentView && currentView.documents.find(function (doc) { return doc.subject === currentView.currentSubject; }); }
      function renderView(view) { currentView = view; projectId = view.projectId; localStorage.setItem('productwoc.projectId', projectId); renderSteps(view.timeline); var discovery = view.discovery || {summary:view.idea,assumptions:[],risks:[],questions:[]}; var doc = currentDocument(); var ready = view.status === 'ready_for_development'; var cancelled = view.status === 'cancelled'; var actions = ready ? '<p class="notice">三份文档及审批绑定已形成 DevelopmentStartEnvelope，可以进入开发。</p><div class="actions"><a class="primary" id="enter-development" href="' + esc(developmentUrl()) + '">进入 Development</a><button class="secondary" id="reopen-spec" type="button">修改已批准的产品规格</button></div><p class="hint">Development 服务默认监听本机 4273 端口；首次进入会从当前 Envelope 创建 Run。</p>' : cancelled ? '<p class="notice">本次规划已取消。你可以使用新的项目标识重新开始。</p>' : '<div class="actions"><button class="primary" id="approve" type="button" ' + (!view.permissions.canApprove ? 'disabled' : '') + '>确认并继续</button><button class="secondary" id="revise" type="button" ' + (!view.permissions.canRevise ? 'disabled' : '') + '>修改当前版本</button>' + (view.currentSubject !== 'project_spec' && view.permissions.canRevise ? '<button class="secondary" id="back" type="button">返回上一阶段</button>' : '') + (view.permissions.canCancel ? '<button class="danger" id="cancel" type="button">取消本次规划</button>' : '') + '</div><p class="hint">写操作同时校验 Idempotency-Key、Version 与内容 Hash。</p>'; app.innerHTML = '<div class="topline"><div class="crumb">' + esc(view.workspaceId) + ' / ' + esc(view.projectId) + '</div><span class="status">' + esc(view.statusLabel) + '</span></div><h1>' + (ready ? '计划已经准备好，可以进入开发。' : cancelled ? '这次规划已停止。' : '先把当前阶段的关键决策说清楚。') + '</h1><p class="lede">' + esc(discovery.summary) + '</p><div class="meta"><span class="pill">Snapshot · r' + view.snapshotRevision + '</span><span class="pill">Checkpoint · r' + view.checkpointRevision + '</span><span class="pill">' + view.approvals + ' / 3 已确认</span><span class="pill">本地私有</span></div><section class="doc-grid" aria-label="规划文档">' + docCard('project_spec','产品规格') + docCard('technical_design','技术设计') + docCard('execution_plan','执行计划') + '</section><div class="grid"><section class="stack"><article class="card"><div class="card-head"><h2>假设、问题与风险</h2></div><div class="card-body"><div class="scope"><div class="scope-box"><h3>默认假设</h3>' + list(discovery.assumptions) + '</div><div class="scope-box out"><h3>待确认问题</h3>' + list(discovery.questions) + '</div></div><div class="risk"><strong>主要风险</strong>' + list(discovery.risks) + '</div></div></article>' + (ready && view.developmentStart ? '<article class="card"><div class="card-head"><h2>开发启动信封</h2></div><div class="card-body"><p class="hint">' + esc(view.developmentStart.envelopeId) + '</p><p>绑定 3 个文档版本、3 个审批记录与工作流定义校验和。</p></div></article>' : '') + '</section><aside class="card approval"><div class="card-head"><div><h2>' + (doc ? '确认 ' + esc(doc.label) : ready ? '规划完成' : '当前状态') + '</h2><p>' + (doc ? '当前版本 v' + doc.version + '，确认后才会生成下一份文档。' : esc(view.statusLabel)) + '</p></div></div><div class="card-body"><div class="metric"><span>审批进度</span><strong>' + view.approvals + '/3</strong></div>' + actions + '</div></aside></div>'; bindActions(); }
      function bindActions() { Array.from(document.querySelectorAll('.view-document')).forEach(function (button) { button.addEventListener('click', function () { var doc = currentView.documents.find(function (item) { return item.subject === button.dataset.subject; }); var latest = doc.versions[doc.versions.length - 1]; document.getElementById('dialog-title').textContent = doc.label + ' · v' + doc.version; document.getElementById('document-content').textContent = doc.markdown + '\\n\\n--- 版本列表 ---\\n' + doc.versions.map(function (item) { return 'v' + item.version + ' · ' + item.versionId + ' · ' + item.hash; }).join('\\n') + '\\n\\n--- 与上一版的结构化 Diff ---\\n' + (latest.structuredDiff.length ? JSON.stringify(latest.structuredDiff, null, 2) : '首个版本，无 Diff'); dialog.showModal(); }); }); var approve = document.getElementById('approve'); if (approve) approve.addEventListener('click', function () { mutate('approve', currentDocument()); }); var revise = document.getElementById('revise'); if (revise) revise.addEventListener('click', function () { var feedback = window.prompt('请输入希望调整的内容'); if (feedback) mutate('revise', currentDocument(), {feedback:feedback}); }); var reopen = document.getElementById('reopen-spec'); if (reopen) reopen.addEventListener('click', function () { var spec = currentView.documents.find(function (item) { return item.subject === 'project_spec'; }); var feedback = window.prompt('请输入产品规格的新调整'); if (spec && feedback) mutate('revise', spec, {feedback:feedback}); }); var back = document.getElementById('back'); if (back) back.addEventListener('click', function () { var order = ['project_spec','technical_design','execution_plan']; var previous = currentView.documents.find(function (doc) { return doc.subject === order[order.indexOf(currentView.currentSubject) - 1]; }); if (previous) mutate('revise', previous, {feedback:'返回上一阶段重新检查范围与绑定'}); }); var cancel = document.getElementById('cancel'); if (cancel) cancel.addEventListener('click', function () { if (window.confirm('确定取消本次规划吗？')) mutate('cancel', currentDocument(), {reason:'用户在产品规格确认阶段取消'}); }); }
      async function start(event) { event.preventDefault(); var form = new FormData(event.currentTarget); projectId = String(form.get('projectId')); setBusy(true); try { var response = await fetch('/api/session/start',{method:'POST',headers:{'content-type':'application/json','x-idempotency-key':requestKey('start')},body:JSON.stringify({projectId:projectId,idea:String(form.get('idea'))})}); var body = await response.json(); if (!response.ok) throw new Error(body.error); renderView(body); } catch (error) { renderStart(error.message); } finally { setBusy(false); } }
      async function mutate(action, doc, extra) { if (!doc) return; setBusy(true); try { var response = await fetch('/api/session/' + action,{method:'POST',headers:{'content-type':'application/json','x-idempotency-key':requestKey(action)},body:JSON.stringify(Object.assign({projectId:projectId,subject:doc.subject,versionId:doc.versionId,hash:doc.hash},extra || {}))}); var body = await response.json(); if (!response.ok) throw new Error(body.error); renderView(body); } catch (error) { window.alert(error.message); } finally { setBusy(false); } }
      async function load() { try { var response = await fetch('/api/session?workspaceId=local-workspace&projectId=' + encodeURIComponent(projectId)); if (response.status === 404) { renderStart(); return; } var body = await response.json(); if (!response.ok) throw new Error(body.error); renderView(body); } catch (error) { renderStart('无法读取本地规划：' + error.message); } }
      document.getElementById('close-dialog').addEventListener('click', function () { dialog.close(); });
      var events = new EventSource('/api/events'); events.addEventListener('planning', function (event) { var view = JSON.parse(event.data); if (view.projectId === projectId) renderView(view); });
      load();
    }());
  </script>
</body>
</html>`;
}
