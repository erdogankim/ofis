const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = __dirname;
const CONFIG_PATH = path.join(ROOT_DIR, 'ofis.config.json');
const DATA_DIR = path.join(ROOT_DIR, 'veri');
const TASKS_PATH = path.join(DATA_DIR, 'gorevler.json');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const REPORTS_DIR = path.join(ROOT_DIR, 'raporlar');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function loadTasksData() {
  try {
    if (fs.existsSync(TASKS_PATH)) {
      return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    toplamToken: { input: 0, output: 0, cacheRead: 0 },
    gorevler: []
  };
}

function saveTasksData(data) {
  fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

let config = loadConfig();
let tasksData = loadTasksData();

const workerStates = {};
const workerQueues = {};
const activeProcesses = new Map();
const sseClients = new Set();

function listReports() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) return [];
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.toLowerCase().endsWith('.md'));
    const items = files.map(f => {
      const fullPath = path.join(REPORTS_DIR, f);
      const stat = fs.statSync(fullPath);
      let baslik = f.replace(/\.md$/i, '');
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const firstHeading = content.split(/\r?\n/).find(line => line.trim().startsWith('#'));
        if (firstHeading) {
          baslik = firstHeading.replace(/^#+\s*/, '').trim();
        }
      } catch (e) {}
      return {
        dosya: f,
        baslik,
        yol: fullPath.replace(/\\/g, '/'),
        tarih: stat.mtime.toISOString(),
        tarihFormatli: stat.mtime.toLocaleString('tr-TR'),
        boyut: stat.size
      };
    });
    items.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
    return items;
  } catch (e) {
    return [];
  }
}

function initWorkers() {
  config = loadConfig();
  for (const c of config.calisanlar || []) {
    if (!workerStates[c.id]) {
      workerStates[c.id] = {
        id: c.id,
        rol: c.rol,
        durum: 'bosta',
        eylem: 'Hazır',
        kuyrukSayisi: 0,
        aktifGorevId: null
      };
    }
    if (!workerQueues[c.id]) {
      workerQueues[c.id] = [];
    }
  }
}

initWorkers();

function isForbiddenPath(targetPath) {
  if (!targetPath) return true;
  const normTarget = path.resolve(targetPath).toLowerCase().replace(/\\/g, '/');
  for (const forbidden of config.yasakKlasorler || []) {
    const normForbid = path.resolve(forbidden).toLowerCase().replace(/\\/g, '/');
    if (normTarget === normForbid || normTarget.startsWith(normForbid + '/')) {
      return true;
    }
  }
  return false;
}

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

// Raporlar klasöründeki dosya değişimlerini canlı izle
try {
  let watchTimer = null;
  fs.watch(REPORTS_DIR, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      broadcast('raporlar_guncelle', listReports());
    }, 250);
  });
} catch (e) {}

function updateWorkerState(id, patch) {
  if (!workerStates[id]) {
    workerStates[id] = { id, rol: id, durum: 'bosta', eylem: 'Hazır', kuyrukSayisi: 0, aktifGorevId: null };
  }
  Object.assign(workerStates[id], patch);
  broadcast('calisan_durum', workerStates[id]);
}

function addLiveLog(gorevId, birimId, mesaj, tip = 'bilgi') {
  broadcast('canli_log', {
    zaman: new Date().toLocaleTimeString('tr-TR'),
    gorevId,
    birimId,
    mesaj,
    tip
  });
}

function getSanitizedState() {
  config = loadConfig();
  initWorkers();
  const safeConfig = JSON.parse(JSON.stringify(config));
  for (const c of safeConfig.calisanlar || []) {
    const geminiMd = path.join(c.klasor, 'GEMINI.md');
    c.geminiMdVar = fs.existsSync(geminiMd);
  }
  return {
    config: safeConfig,
    durumlar: workerStates,
    toplamToken: tasksData.toplamToken,
    gorevler: tasksData.gorevler.slice(0, 50),
    raporlar: listReports(),
    raporKlasoru: REPORTS_DIR.replace(/\\/g, '/')
  };
}

function formatGeminiToolAction(toolName, params) {
  const name = String(toolName || '');
  const p = params || {};
  const targetFile = p.Path || p.TargetFile || p.DirectoryPath || p.SearchPath || '';
  const base = targetFile ? path.basename(targetFile) : '';

  if (name === 'read_file' || name === 'view_file') {
    return `📖 ${base || 'Dosya'} okunuyor...`;
  }
  if (name === 'write_to_file' || name === 'write_file' || name === 'replace_file_content' || name === 'multi_replace_file_content' || name === 'edit_file') {
    return `✍️ ${base || 'Rapor'} yazılıyor...`;
  }
  if (name === 'list_dir' || name === 'find_by_name' || name === 'grep_search') {
    return `🔍 Klasörde arama yapılıyor...`;
  }
  if (name === 'search_web' || name === 'read_url_content') {
    return `🌐 İnternette araştırılıyor...`;
  }
  if (name === 'run_command') {
    return `⚙️ Komut çalıştırılıyor...`;
  }
  return `🔧 ${name} çalıştırılıyor...`;
}

function recordUsage(usage) {
  if (!usage) return;
  tasksData.toplamToken.input = (tasksData.toplamToken.input || 0) + Number(usage.input_tokens || 0);
  tasksData.toplamToken.output = (tasksData.toplamToken.output || 0) + Number(usage.output_tokens || 0);
  tasksData.toplamToken.cacheRead = (tasksData.toplamToken.cacheRead || 0) + Number(usage.cache_read_tokens || 0);
  saveTasksData(tasksData);
  broadcast('token_guncelle', tasksData.toplamToken);
}

function slugifyTR(str) {
  return String(str || 'rapor')
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'rapor';
}

function runGeneralManagerRouter(gorevMetni, gorevId) {
  return new Promise((resolve) => {
    const calisanlar = config.calisanlar || [];
    const digerCalisanlar = calisanlar.filter(c => c.id !== 'genel-mudur');
    if (digerCalisanlar.length === 0) {
      return resolve({
        ozet: 'Genel Müdür görevi üstlendi.',
        adimlar: [{ birim: 'genel-mudur', gorev: gorevMetni }]
      });
    }

    const geminiExe = (config.ofis && config.ofis.geminiExe) || 'C:/Users/oztur/AppData/Local/agy/bin/agy.exe';
    const gmModel = (config.genelMudur && config.genelMudur.model) || (config.ofis && config.ofis.model) || 'gemini-3.8-flash-high';

    const listeMetni = calisanlar.map(c => `- id: "${c.id}", rol: "${c.rol}", aciklama: "${c.aciklama}"`).join('\n');
    const routerPrompt = [
      `Sen Ofis sisteminin Genel Müdürüsün. Aşağıdaki görevi analiz et ve listedeki en uygun çalışana (veya sıralı zincire) yönlendir.`,
      `Çalışan listesi:\n${listeMetni}`,
      `Sadece geçerli bir JSON döndür, başka hiçbir metin yazma:`,
      `{"ozet":"<kısa yönlendirme özeti>","adimlar":[{"birim":"<id>","gorev":"<talimat>"}]}`,
      ``,
      `Görev: ${gorevMetni}`
    ].join('\n');

    updateWorkerState('genel-mudur', {
      durum: 'dusunuyor',
      eylem: '🧠 Görevi analiz edip dağıtıyor...',
      aktifGorevId: gorevId
    });
    addLiveLog(gorevId, 'genel-mudur', 'Genel Müdür görevi yönlendiriyor...', 'bilgi');

    const child = spawn(geminiExe, [
      '--output-format', 'json',
      '--mode', 'plan',
      '--dangerously-skip-permissions',
      '--disable-slash-commands',
      '--model', gmModel,
      '-p', routerPrompt
    ], {
      cwd: ROOT_DIR,
      windowsHide: true
    });

    activeProcesses.set(gorevId, child);
    let stdout = '';
    child.stdout.on('data', d => { stdout += d.toString('utf8'); });

    child.on('close', () => {
      updateWorkerState('genel-mudur', { durum: 'bosta', eylem: 'Hazır', aktifGorevId: null });
      try {
        const outer = JSON.parse(stdout.trim());
        if (outer.usage) recordUsage(outer.usage);
        const text = outer.response || stdout;
        const match = text.match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : null;
        if (parsed && Array.isArray(parsed.adimlar) && parsed.adimlar.length > 0) {
          return resolve(parsed);
        }
      } catch (e) {}
      resolve({
        ozet: 'Genel Müdür görevi üstlendi.',
        adimlar: [{ birim: 'genel-mudur', gorev: gorevMetni }]
      });
    });

    child.on('error', () => {
      updateWorkerState('genel-mudur', { durum: 'bosta', eylem: 'Hazır', aktifGorevId: null });
      resolve({
        ozet: 'Genel Müdür görevi üstlendi.',
        adimlar: [{ birim: 'genel-mudur', gorev: gorevMetni }]
      });
    });
  });
}

function runGeminiWorkerStep(worker, promptText, gorevObj) {
  return new Promise((resolve, reject) => {
    if (isForbiddenPath(worker.klasor)) {
      return reject(new Error(`Güvenlik Engeli: "${worker.klasor}" yasak klasör!`));
    }
    if (!fs.existsSync(worker.klasor)) {
      fs.mkdirSync(worker.klasor, { recursive: true });
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const suggestedSlug = slugifyTR(gorevObj.metin);
    const suggestedFileName = `${dateStr}-${gorevObj.id.toLowerCase()}-${suggestedSlug}.md`;
    const suggestedReportPath = path.join(REPORTS_DIR, suggestedFileName).replace(/\\/g, '/');

    const beforeFiles = new Set(fs.existsSync(REPORTS_DIR) ? fs.readdirSync(REPORTS_DIR) : []);

    const geminiExe = (config.ofis && config.ofis.geminiExe) || 'C:/Users/oztur/AppData/Local/agy/bin/agy.exe';
    const model = worker.model || (config.ofis && config.ofis.model) || 'gemini-3.8-flash-high';

    const fullPrompt = [
      `[OFİS GÖREV TALİMATI]`,
      `- Rolün: ${worker.rol} (Bulunduğun klasördeki GEMINI.md kurallarına sadık kal).`,
      `- Merkezi Rapor Klasörü: "${REPORTS_DIR}"`,
      `- Hazırlayacağın raporu mutlaka "${suggestedReportPath}" dosyasına Markdown (.md) formatında kaydet.`,
      `- YASAK: Mevcut kaynak dosyaları silme, dışarıda yayınlama/paylaşma/ödeme işlemi yapma.`,
      `- İş bitince ne yaptığını ve rapor dosyasının adını kısaca özetle.`,
      ``,
      `GÖREV:`,
      promptText
    ].join('\n');

    updateWorkerState(worker.id, {
      durum: 'dusunuyor',
      eylem: '🧠 Gemini düşünüyor...',
      aktifGorevId: gorevObj.id
    });
    addLiveLog(gorevObj.id, worker.id, `${worker.rol} çalışmaya başladı.`, 'bilgi');

    const child = spawn(geminiExe, [
      '--output-format', 'stream-json',
      '--mode', 'accept-edits',
      '--dangerously-skip-permissions',
      '--disable-slash-commands',
      '--add-dir', REPORTS_DIR,
      '--model', model,
      '-p', fullPrompt
    ], {
      cwd: worker.klasor,
      windowsHide: true
    });

    activeProcesses.set(gorevObj.id, child);

    let buffer = '';
    let stderr = '';
    let streamedText = '';
    let finalResponse = '';
    let conversationId = '';
    let usageObj = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };

    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed);
          if (ev.event === 'init') {
            conversationId = ev.conversation_id || conversationId;
            updateWorkerState(worker.id, {
              durum: 'calisiyor',
              eylem: '📖 GEMINI.md ve klasör inceleniyor...'
            });
          } else if (ev.event === 'step_update' && ev.step_update) {
            const su = ev.step_update;
            conversationId = su.conversation_id || conversationId;
            if (su.step_type === 'tool' && su.state === 'ACTIVE') {
              const params = (su.tool_info && su.tool_info.parameters) || {};
              const actionText = formatGeminiToolAction(su.tool_name, params);
              updateWorkerState(worker.id, {
                durum: 'calisiyor',
                eylem: actionText
              });
              addLiveLog(gorevObj.id, worker.id, `${worker.rol}: ${actionText}`, 'arac');
            } else if (su.step_type === 'agent_response' && su.text_delta) {
              streamedText += su.text_delta;
              updateWorkerState(worker.id, {
                durum: 'calisiyor',
                eylem: '✍️ Rapor yazılıyor...'
              });
            }
          } else if (ev.event === 'result' && ev.result) {
            conversationId = ev.result.conversation_id || conversationId;
            finalResponse = ev.result.response || streamedText;
            if (ev.result.usage) usageObj = ev.result.usage;
          }
        } catch (e) {}
      }
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', err => {
      updateWorkerState(worker.id, { durum: 'hata', eylem: `❌ Hata: ${err.message}`, aktifGorevId: null });
      reject(err);
    });

    child.on('close', code => {
      if (gorevObj.durduruldu) {
        updateWorkerState(worker.id, { durum: 'bosta', eylem: 'Durduruldu', aktifGorevId: null });
        return resolve({
          rapor: 'Görev durduruldu.',
          raporDosya: null,
          sessionId: conversationId,
          usage: usageObj
        });
      }

      const reportText = (finalResponse || streamedText || '').trim();
      if (code !== 0 && !reportText) {
        const errMsg = stderr.trim() || `Gemini işlem kodu ${code} ile sonlandı.`;
        updateWorkerState(worker.id, { durum: 'hata', eylem: '❌ Hata oluştu', aktifGorevId: null });
        return reject(new Error(errMsg));
      }

      recordUsage(usageObj);

      // Görev sırasında D:/ofis/raporlar içine yeni bir .md yazıldı mı kontrol et
      const afterFiles = fs.existsSync(REPORTS_DIR) ? fs.readdirSync(REPORTS_DIR).filter(f => f.toLowerCase().endsWith('.md')) : [];
      let createdReportFile = afterFiles.find(f => !beforeFiles.has(f));

      if (!createdReportFile && fs.existsSync( path.join(REPORTS_DIR, suggestedFileName) )) {
        createdReportFile = suggestedFileName;
      }

      // Eğer ajan dosyayı doğrudan oluşturmadıysa, ürettiği yanıtı raporlar klasörüne .md olarak kaydet
      if (!createdReportFile && reportText) {
        try {
          fs.writeFileSync(path.join(REPORTS_DIR, suggestedFileName), reportText, 'utf8');
          createdReportFile = suggestedFileName;
        } catch (e) {}
      }

      broadcast('raporlar_guncelle', listReports());

      updateWorkerState(worker.id, {
        durum: 'bitti',
        eylem: '✅ Rapor hazırlandı',
        aktifGorevId: null
      });
      addLiveLog(gorevObj.id, worker.id, `${worker.rol} raporu tamamladı: ${createdReportFile || ''}`, 'basari');

      setTimeout(() => {
        if (workerStates[worker.id] && workerStates[worker.id].durum === 'bitti') {
          updateWorkerState(worker.id, { durum: 'bosta', eylem: 'Hazır' });
        }
      }, 4000);

      resolve({
        rapor: reportText || 'Görev tamamlandı.',
        raporDosya: createdReportFile || null,
        sessionId: conversationId,
        usage: usageObj
      });
    });
  });
}

function enqueueWorkerJob(workerId, jobFn) {
  return new Promise((resolve, reject) => {
    if (!workerQueues[workerId]) workerQueues[workerId] = [];
    workerQueues[workerId].push({ jobFn, resolve, reject });
    updateWorkerState(workerId, { kuyrukSayisi: workerQueues[workerId].length });
    if (workerQueues[workerId].length === 1) {
      processNextInQueue(workerId);
    }
  });
}

async function processNextInQueue(workerId) {
  const queue = workerQueues[workerId];
  if (!queue || queue.length === 0) {
    updateWorkerState(workerId, { kuyrukSayisi: 0 });
    return;
  }
  const current = queue[0];
  updateWorkerState(workerId, { kuyrukSayisi: queue.length - 1 });
  try {
    const res = await current.jobFn();
    current.resolve(res);
  } catch (err) {
    current.reject(err);
  } finally {
    queue.shift();
    updateWorkerState(workerId, { kuyrukSayisi: queue.length });
    if (queue.length > 0) {
      processNextInQueue(workerId);
    }
  }
}

async function executeTaskFlow(gorevObj) {
  try {
    config = loadConfig();
    const plan = await runGeneralManagerRouter(gorevObj.metin, gorevObj.id);
    gorevObj.planOzeti = plan.ozet;
    broadcast('gorev_guncelle', gorevObj);

    let oncekiRapor = '';
    const tumRaporlar = [];

    for (let i = 0; i < plan.adimlar.length; i++) {
      if (gorevObj.durduruldu) break;
      const adim = plan.adimlar[i];
      const worker = (config.calisanlar || []).find(c => c.id === adim.birim) || (config.calisanlar || [])[0];

      let zincirMetni = adim.gorev;
      if (oncekiRapor) {
        zincirMetni = `Önceki adımın raporu:\n---\n${oncekiRapor.slice(0, 4000)}\n---\n\nGörev:\n${adim.gorev}`;
      }

      const stepResult = await enqueueWorkerJob(worker.id, () => runGeminiWorkerStep(worker, zincirMetni, gorevObj));
      oncekiRapor = stepResult.rapor || '';
      tumRaporlar.push(stepResult.rapor);

      gorevObj.rapor = tumRaporlar.join('\n\n---\n\n');
      gorevObj.raporDosya = stepResult.raporDosya;
      gorevObj.sessionId = stepResult.sessionId;
      gorevObj.sorumluRol = worker.rol;
      if (stepResult.usage) {
        gorevObj.token = {
          input: (gorevObj.token.input || 0) + (stepResult.usage.input_tokens || 0),
          output: (gorevObj.token.output || 0) + (stepResult.usage.output_tokens || 0),
          cacheRead: (gorevObj.token.cacheRead || 0) + (stepResult.usage.cache_read_tokens || 0)
        };
      }
      broadcast('gorev_guncelle', gorevObj);
    }

    gorevObj.durum = gorevObj.durduruldu ? 'durduruldu' : 'bitti';
    gorevObj.bitisZamani = new Date().toISOString();
    activeProcesses.delete(gorevObj.id);
    saveTasksData(tasksData);
    broadcast('gorev_guncelle', gorevObj);
  } catch (err) {
    gorevObj.durum = 'hata';
    gorevObj.hata = err.message;
    gorevObj.bitisZamani = new Date().toISOString();
    activeProcesses.delete(gorevObj.id);
    saveTasksData(tasksData);
    addLiveLog(gorevObj.id, 'genel-mudur', `Hata: ${err.message}`, 'hata');
    broadcast('gorev_guncelle', gorevObj);
  }
}

function createAndStartTask(metin) {
  const gorevId = 'GRV-' + Date.now().toString().slice(-6);
  const gorevObj = {
    id: gorevId,
    metin,
    durum: 'calisiyor',
    baslangicZamani: new Date().toISOString(),
    bitisZamani: null,
    planOzeti: '',
    sorumluRol: 'Genel Müdür',
    raporDosya: null,
    sessionId: '',
    rapor: '',
    hata: null,
    token: { input: 0, output: 0, cacheRead: 0 }
  };

  tasksData.gorevler.unshift(gorevObj);
  if (tasksData.gorevler.length > 100) tasksData.gorevler.length = 100;
  saveTasksData(tasksData);
  broadcast('gorev_yeni', gorevObj);

  executeTaskFlow(gorevObj);
  return gorevObj;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Geçersiz JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data, reqMethod) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  if (reqMethod === 'HEAD') {
    return res.end();
  }
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = urlObj.pathname;

  const isGetOrHead = req.method === 'GET' || req.method === 'HEAD';

  if (req.method === 'GET' && pathname === '/api/akis') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write(`event: ilk_durum\ndata: ${JSON.stringify(getSanitizedState())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (isGetOrHead && pathname === '/api/durum') {
    return sendJson(res, 200, getSanitizedState(), req.method);
  }

  if (isGetOrHead && pathname === '/api/raporlar') {
    return sendJson(res, 200, {
      klasor: REPORTS_DIR.replace(/\\/g, '/'),
      raporlar: listReports()
    }, req.method);
  }

  if (isGetOrHead && pathname === '/api/rapor') {
    const rawName = urlObj.searchParams.get('dosya') || '';
    const safeName = path.basename(rawName);
    if (!safeName || !safeName.toLowerCase().endsWith('.md')) {
      return sendJson(res, 400, { hata: 'Geçersiz rapor dosyası.' }, req.method);
    }
    const fullPath = path.join(REPORTS_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      return sendJson(res, 404, { hata: 'Rapor dosyası bulunamadı.' }, req.method);
    }
    const stat = fs.statSync(fullPath);
    const icerik = fs.readFileSync(fullPath, 'utf8');
    return sendJson(res, 200, {
      dosya: safeName,
      yol: fullPath.replace(/\\/g, '/'),
      tarih: stat.mtime.toLocaleString('tr-TR'),
      icerik
    }, req.method);
  }

  if (isGetOrHead && pathname === '/api/calisan-md') {
    const id = urlObj.searchParams.get('id');
    const c = (config.calisanlar || []).find(w => w.id === id);
    if (!c) return sendJson(res, 404, { hata: 'Çalışan bulunamadı' }, req.method);
    const mdPath = path.join(c.klasor, 'GEMINI.md');
    const icerik = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : 'GEMINI.md henüz oluşturulmamış.';
    return sendJson(res, 200, { id: c.id, rol: c.rol, klasor: c.klasor, icerik }, req.method);
  }

  if (req.method === 'POST' && pathname === '/api/gorev') {
    try {
      const body = await parseJsonBody(req);
      const metin = String(body.metin || '').trim();
      if (!metin) return sendJson(res, 400, { hata: 'Görev metni boş olamaz.' });
      const gorev = createAndStartTask(metin);
      return sendJson(res, 200, { basarili: true, gorev });
    } catch (err) {
      return sendJson(res, 400, { hata: err.message });
    }
  }

  if (req.method === 'POST' && pathname.startsWith('/api/gorev/') && pathname.endsWith('/durdur')) {
    const gorevId = pathname.split('/')[3];
    const gorev = tasksData.gorevler.find(g => g.id === gorevId);
    if (gorev) {
      gorev.durduruldu = true;
      gorev.durum = 'durduruldu';
      const proc = activeProcesses.get(gorevId);
      if (proc && typeof proc.kill === 'function') {
        try { proc.kill(); } catch (e) {}
      }
      activeProcesses.delete(gorevId);
      saveTasksData(tasksData);
      broadcast('gorev_guncelle', gorev);
      return sendJson(res, 200, { basarili: true });
    }
    return sendJson(res, 404, { hata: 'Görev bulunamadı' });
  }

  if (req.method === 'POST' && pathname === '/api/calisan') {
    try {
      const body = await parseJsonBody(req);
      const rol = String(body.rol || '').trim();
      if (!rol) return sendJson(res, 400, { hata: 'Çalışan unvanı zorunludur.' });

      const id = slugifyTR(body.id || rol);
      const klasor = body.klasor
        ? String(body.klasor).trim().replace(/\\/g, '/')
        : path.join(ROOT_DIR, 'calisanlar', id).replace(/\\/g, '/');

      if (isForbiddenPath(klasor)) {
        return sendJson(res, 400, { hata: 'Bu klasör yasak klasörler listesinde!' });
      }

      fs.mkdirSync(klasor, { recursive: true });

      const geminiMdPath = path.join(klasor, 'GEMINI.md');
      if (!fs.existsSync(geminiMdPath)) {
        const defaultMd = [
          `# ${rol} — İş Tanımı (GEMINI.md)`,
          ``,
          `## Kimsin ve Kime Çalışıyorsun`,
          `Sen **Ofis** bünyesinde **${rol}** olarak çalışıyorsun. Patronun **Mustafa**'dır.`,
          ``,
          `## Görevlerin`,
          `- ${body.aciklama || 'Verilen görevleri kendi uzmanlık alanında yerine getir ve raporla.'}`,
          `- Hazırladığın raporları mutlaka \`${REPORTS_DIR}\` klasörüne Markdown (.md) olarak kaydet.`,
          ``,
          `## Çıktı Kuralları`,
          `- Türkçe, kısa, net Markdown çıktısı üret.`,
          ``,
          `## YAPMA Listesi`,
          `- Mevcut kaynak dosyaları silme.`,
          `- Emin olmadığın verileri uydurma.`,
          `- Dışarıda hiçbir şeyi yayınlama, ödeme veya mesaj gönderme.`
        ].join('\n');
        fs.writeFileSync(geminiMdPath, defaultMd, 'utf8');
      }

      const ekipAdi = String(body.ekipAdi || 'Yönetim').trim();
      const ekipId = slugifyTR(ekipAdi) || 'yonetim';

      if (!config.ekipler.some(e => e.id === ekipId)) {
        config.ekipler.push({ id: ekipId, ad: ekipAdi });
      }

      const yeniCalisan = {
        id,
        rol,
        ekip: ekipId,
        klasor,
        aciklama: body.aciklama || `${rol} birimi`,
        renk: body.renk ? String(body.renk).trim() : undefined,
        model: (config.ofis && config.ofis.model) || 'gemini-3.8-flash-high'
      };

      const idx = config.calisanlar.findIndex(c => c.id === id);
      if (idx >= 0) config.calisanlar[idx] = yeniCalisan;
      else config.calisanlar.push(yeniCalisan);

      saveConfig(config);
      initWorkers();
      broadcast('ilk_durum', getSanitizedState());
      return sendJson(res, 200, { basarili: true, calisan: yeniCalisan });
    } catch (err) {
      return sendJson(res, 400, { hata: err.message });
    }
  }

  if (isGetOrHead) {
    const reqFile = (pathname === '/' || pathname === '/index.html') ? 'index.html' : pathname.replace(/^\/+/, '');
    const safeTarget = path.normalize(path.join(PUBLIC_DIR, reqFile));
    if (safeTarget.startsWith(PUBLIC_DIR) && fs.existsSync(safeTarget) && fs.statSync(safeTarget).isFile()) {
      const ext = path.extname(safeTarget).toLowerCase();
      const mimeMap = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
      };
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
      if (req.method === 'HEAD') {
        return res.end();
      }
      return res.end(fs.readFileSync(safeTarget));
    }
  }

  sendJson(res, 404, { hata: 'Bulunamadı' });
});

const PORT = (config.ofis && config.ofis.port) || 4747;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ofis aktif: http://localhost:${PORT} (Motor: Gemini | Raporlar: ${REPORTS_DIR})`);
});
