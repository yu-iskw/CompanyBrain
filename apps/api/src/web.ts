export const webPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CompanyBrain</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #17202a; background: #f4f6f8; }
    body { margin: 0; }
    main { max-width: 880px; margin: 0 auto; padding: 64px 24px; }
    h1 { font-size: clamp(2.2rem, 6vw, 4rem); margin: 0; letter-spacing: -.06em; }
    .tagline { color: #59636e; font-size: 1.1rem; margin: 10px 0 32px; }
    form { display: flex; gap: 10px; background: white; border: 1px solid #d8dee4; border-radius: 14px; padding: 8px; box-shadow: 0 8px 28px #1f293714; }
    input { flex: 1; border: 0; outline: 0; font: inherit; padding: 12px; min-width: 0; }
    button, .button { border: 0; border-radius: 9px; background: #25324a; color: white; padding: 12px 18px; font-weight: 650; cursor: pointer; text-decoration: none; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 30px; color: #65717e; }
    article { background: white; border: 1px solid #dfe3e8; border-radius: 12px; padding: 20px; margin: 12px 0; }
    article h2 { margin: 0 0 8px; font-size: 1.05rem; }
    article a { color: #174ea6; text-decoration: none; }
    article p { line-height: 1.55; color: #3d4852; white-space: pre-wrap; }
    .meta { color: #77818c; font-size: .84rem; }
    .error { color: #9f2d2d; padding: 12px 0; }
  </style>
</head>
<body><main>
  <h1>CompanyBrain</h1>
  <p class="tagline">Permission-aware knowledge retrieval, directly from the systems you already use.</p>
  <form id="search"><input id="query" aria-label="Search" placeholder="Search company knowledge…" required><button>Search</button></form>
  <div class="toolbar"><span id="status">Sources are queried with your delegated identity.</span><span><a class="button" href="/oauth/slack/start">Connect Slack</a> <a class="button" href="/oauth/github/start">Connect GitHub</a></span></div>
  <section id="results" aria-live="polite"></section>
</main>
<script nonce="company-brain">
const form = document.querySelector('#search');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const escapeHtml = value => String(value).replace(/[&<>\"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[character]));
form.addEventListener('submit', async event => {
  event.preventDefault(); results.replaceChildren(); status.textContent = 'Searching linked sources…';
  try {
    const response = await fetch('/api/search', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({query:document.querySelector('#query').value})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed');
    status.textContent = data.results.length + ' result(s)';
    results.innerHTML = data.results.map(item => '<article><h2><a target="_blank" rel="noreferrer" href="'+escapeHtml(item.url)+'">'+escapeHtml(item.title)+'</a></h2><p>'+escapeHtml(item.excerpt)+'</p><div class="meta">'+escapeHtml(item.author || 'Unknown author')+' · '+escapeHtml(item.createdAt || '')+'</div></article>').join('') + data.failures.map(item => '<p class="error">'+escapeHtml(item.sourceId)+': '+escapeHtml(item.message)+'</p>').join('');
  } catch (error) { status.textContent = 'Search failed'; results.innerHTML = '<p class="error">'+escapeHtml(error.message)+'</p>'; }
});
</script></body></html>`;
