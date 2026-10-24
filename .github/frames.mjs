// four views of his train simulator as it runs, on one picture, for him to look at (world/Trains.js, framesTick). made on
// GitHub's machines when the town asks, after he adds to it, never on the town's server (Sam, 24 Oct: "don't render it
// on the server"). the page is served from the checkout, opened in a browser with no graphics card (the drawing is done in
// software, slowly), left to bring in its ground, and seen from the cab, from behind, from beside and from above, a few
// seconds apart. what the town asked to be filmed is frames.json beside the page: { line, hour, for }, and `for` goes
// into what is made, which is how the town knows the film is of what it asked for
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const OUT = join(ROOT, 'frames')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' }
const VIEWS = [['cab', 'from the cab'], ['chase', 'from behind the train'], ['side', 'from beside the track'], ['drone', 'from above']]
const LOAD_MS = Number(process.env.FRAMES_LOAD_MS || 30000)

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  try {
    const body = await readFile(join(ROOT, path.endsWith('/') ? `${path}index.html` : path))
    res.writeHead(200, { 'Content-Type': TYPES[extname(path) || '.html'] || 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end() }
}).listen(0)
const port = server.address().port

const ask = JSON.parse(await readFile(join(ROOT, 'frames.json'), 'utf8').catch(() => '{}'))
// (FRAMES_CHROME: a browser already on the machine, for trying it on a desk)
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.FRAMES_CHROME ? { executablePath: process.env.FRAMES_CHROME } : {}) })
const shots = []
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
  const q = new URLSearchParams({ ...(ask.line ? { line: ask.line } : {}), hour: String(ask.hour ?? 12.5), rate: '4' })
  await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForSelector('#loading', { state: 'detached', timeout: 240_000 })
  // (the ground, the photograph of it and the scenery on it come in while it runs)
  await page.waitForTimeout(LOAD_MS)
  // the picture, not the panels over it
  await page.addStyleTag({ content: '.panel { display: none !important }' })
  for (const [cam] of VIEWS) {
    await page.evaluate((c) => document.querySelector(`[data-cam="${c}"]`)?.click(), cam)
    await page.waitForTimeout(4000)
    shots.push((await page.screenshot({ type: 'png' })).toString('base64'))
  }
  // the four on one sheet, two by two, in the order they were taken
  const sheet = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:640px 640px;grid-template-rows:400px 400px">${shots.map((s) => `<img src="data:image/png;base64,${s}" style="width:640px;height:400px;display:block">`).join('')}</body>`)
  await mkdir(OUT, { recursive: true })
  await sheet.screenshot({ path: join(OUT, 'sheet.png'), type: 'png' })
  await writeFile(join(OUT, 'frames.json'), JSON.stringify({ for: ask.for ?? null, at: new Date().toISOString(), line: ask.line || null, hour: ask.hour ?? 12.5, views: VIEWS.map(([, said]) => said), of: process.env.GITHUB_SHA || null }, null, 2))
  console.log(`four views of ${ask.line || 'the first line'} on frames/sheet.png`)
} finally {
  await browser.close()
  server.close()
}
