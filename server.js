
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const PORT = process.env.PORT || 3000;
const FILE = process.env.DATA_FILE || path.join(root, 'treasure-data.json');
const missions = JSON.parse(fs.readFileSync(path.join(root, 'missions.json'), 'utf8'));
const COUNT = missions.length;
const MAX_TEAMS = 40;

let db = {
  teams: {},
  places: missions.map(m => m.place),


open: true,
gps: Array.from({length: 15}, () => null),
testMode: false


};

try {
  db = {...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8'))};
} catch {}

if (!Array.isArray(db.places) || db.places.length !== COUNT) {
  db.places = missions.map((m, i) => db.places?.[i] || m.place);
}

if (!Array.isArray(db.gps) || db.gps.length !== COUNT) {
  db.gps = Array.from({length: COUNT}, () => null);
}

for (const t of Object.values(db.teams)) {
  t.done = Array.from({length: COUNT}, (_, i) => Boolean(t.done?.[i]));
  t.pending = (t.pending || []).filter(i => Number.isInteger(i) && i >= 1 && i <= COUNT && !t.done[i - 1]);
}

const save = () => {
  fs.mkdirSync(path.dirname(FILE), {recursive: true});
  const temp = FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db));
  fs.renameSync(temp, FILE);
};

const send = (res, status, obj) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
};

const read = async req => {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 20000) throw Error('요청이 너무 큽니다');
  }
  return s ? JSON.parse(s) : {};
};

const auth = req => {
  const pin = process.env.ADMIN_PIN;
  if (!pin) return false;
  const a = Buffer.from(String(req.headers['x-admin-pin'] || ''));
  const b = Buffer.from(pin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const validId = id => Number.isInteger(Number(id)) &&
  Number(id) >= 1 && Number(id) <= MAX_TEAMS &&
  String(Number(id)) === String(id);

const token = req => String(req.headers['x-team-token'] || '');

const team = req => {
  const tk = token(req);
  if (!tk) return undefined;
  return Object.entries(db.teams).find(([id, t]) => t.token === tk);
};

const publicTeam = (id, t) => {
  const completed = t.done.filter(Boolean).length;
  return {
    id,
    name: t.name,
    done: t.done,
    pending: t.pending,
    score: completed * 100,
    pieces: completed,
    total: COUNT,
    unlocked: completed === COUNT,
    finalRequested: !!t.finalRequested,
finalApproved: !!t.finalApproved,
updated: t.updated
  };
};

const summary = () => Array.from({length: MAX_TEAMS}, (_, i) => {
  const id = String(i + 1);
  const t = db.teams[id];
  return t ? publicTeam(id, t) : {
    id,
    name: '',
    done: Array(COUNT).fill(false),
    pending: [],
    score: 0,
    pieces: 0,
    total: COUNT,
    unlocked: false
  };
});

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');

    if (u.pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        missions: missions.map((m, i) => ({
          id: i + 1,
          title: m.title,
          category: m.category,
          place: db.places[i],
          description: m.description,
          type: m.type,
          points: m.points || 100,
          gps: db.gps?.[i] || null
        })),
        
open: db.open,
testMode: db.testMode === true

      });
    }

    if (u.pathname === '/api/join' && req.method === 'POST') {
      const b = await read(req);
      const id = String(Number(b.team));

      if (!validId(id)) return send(res, 400, {error: '1~40팀만 가능합니다'});
      if (db.teams[id]) return send(res, 409, {
        error: '이미 등록된 팀입니다. 관리자에게 초기화를 요청하세요.'
      });

      const t = {
        name: String(b.name || id + '팀').slice(0, 25),
        token: crypto.randomBytes(24).toString('hex'),
        done: Array(COUNT).fill(false),
        pending: [],
        updated: Date.now()
      };

      db.teams[id] = t;
      save();
      return send(res, 200, {token: t.token, team: publicTeam(id, t)});
    }

    if (u.pathname === '/api/me' && req.method === 'GET') {
      const x = team(req);
      return x
        ? send(res, 200, {team: publicTeam(...x), open: db.open})
        : send(res, 401, {error: '팀 인증 실패'});
    }

    if (u.pathname === '/api/submit' && req.method === 'POST') {
      const x = team(req);
      if (!x) return send(res, 401, {error: '팀 인증 실패'});
      if (!db.open) return send(res, 403, {error: '행사가 종료되었습니다'});

      const [id, t] = x;
      const b = await read(req);
      const i = Number(b.mission) - 1;

      if (!Number.isInteger(i) || i < 0 || i >= COUNT) {
        return send(res, 400, {error: '미션 번호 오류'});
      }
      if (t.done[i]) return send(res, 409, {error: '이미 완료한 미션입니다'});

     
const answer = String(missions[i].answer || '').trim().toUpperCase();
const submitted = String(b.answer || '').trim().toUpperCase();

if (!answer || submitted !== answer) {
  return send(res, 400, {error: '미션 정답을 다시 확인해주세요.'});
}

t.done[i] = true;
 

      t.updated = Date.now();
      save();
      return send(res, 200, {team: publicTeam(id, t)});
    }

// 15개 미션 완료 시 최종 승인 요청
if (u.pathname === '/api/final-request' && req.method === 'POST') {
  const x = team(req);
  if (!x) return send(res, 401, {error: '팀 인증 실패'});

  const [id, t] = x;
  if (!t.done || t.done.filter(Boolean).length !== COUNT) {
    return send(res, 400, {error: '15개 미션을 먼저 완료해주세요.'});
  }

  if (t.finalApproved) {
    return send(res, 200, {approved: true});
  }

  t.finalRequested = true;
  t.updated = Date.now();
  save();

  return send(res, 200, {
    requested: true,
    message: '관리자 최종 승인을 기다리고 있습니다.'
  });
}


    if (u.pathname.startsWith('/api/admin/')) {
      if (!auth(req)) return send(res, 401, {
        error: '관리자 인증이 필요합니다'
      });

      if (u.pathname === '/api/admin/state' && req.method === 'GET') {
        return send(res, 200, {
          teams: summary(),
          places: db.places,
          open: db.open,
          gps: db.gps,
          missions: missions.map(m => ({
            title: m.title,
            type: m.type,
            category: m.category
          }))
        });
      }

      if (req.method !== 'POST') {
        return send(res, 405, {error: 'POST만 허용합니다'});
      }

      const b = await read(req);

if (u.pathname === '/api/admin/final-approve') {
  const id = String(Number(b.team));
  const t = db.teams[id];

  if (!t) {
    return send(res, 404, {error:'팀을 찾을 수 없습니다.'});
  }

  if (!t.finalRequested) {
    return send(res, 400, {error:'최종 승인 요청이 없습니다.'});
  }

  if (!Array.isArray(t.done) || t.done.filter(Boolean).length !== COUNT) {
    return send(res, 400, {error:'15개 미션을 모두 완료해야 합니다.'});
  }

  t.finalApproved = true;
  t.updated = Date.now();
  save();

  return send(res, 200, {approved:true});
}

      if (u.pathname === '/api/admin/approve') {
        const id = String(Number(b.team));
        const i = Number(b.mission);
        const t = db.teams[id];

        if (!t || !Number.isInteger(i) || i < 1 || i > COUNT ||
            !t.pending.includes(i)) {
          return send(res, 400, {error: '승인 대기 기록이 없습니다'});
        }

        t.pending = t.pending.filter(x => x !== i);
        t.done[i - 1] = true;
        t.updated = Date.now();
        save();
        return send(res, 200, {ok: true, team: publicTeam(id, t)});
      }

      if (u.pathname === '/api/admin/reset-team') {
        const id = String(Number(b.team));
        if (!validId(id)) return send(res, 400, {error: '팀 번호 오류'});
        delete db.teams[id];
        save();
        return send(res, 200, {ok: true});
      }

      if (u.pathname === '/api/admin/reset-all') {
        if (b.confirm !== '전체 초기화') {
          return send(res, 400, {error: '확인 문구 오류'});
        }
        db.teams = {};
        save();
        return send(res, 200, {ok: true});
      }

      if (u.pathname === '/api/admin/settings') {
        if (Array.isArray(b.places) && b.places.length === COUNT) {
          db.places = b.places.map(x => String(x).slice(0, 100));
        }
        if (typeof b.open === 'boolean') db.open = b.open;
        
if (typeof b.testMode === 'boolean') db.testMode = b.testMode;

        
if (Array.isArray(b.gps) && b.gps.length === COUNT) {
  db.gps = b.gps.map(p => {
    if (p === null) return null;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return {lat, lng};
  });
}

        save();
        return send(res, 200, {ok: true});
      }

      return send(res, 404, {error: '없는 API'});
    }

    if (req.method !== 'GET') {
      return send(res, 405, {error: 'GET만 허용'});
    }

    const name = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);

    
if (!['index.html', 'admin.html', 'manifest.json', '✨ NEW MISSION_ 팀워크 암호 도전.png'].includes(name)) {

      return send(res, 404, {error: '없음'});
    }

    const file = path.join(root, name);
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, {error: '파일 없음'});
      res.writeHead(200, {
      'Content-Type': name.endsWith('.html')
  ? 'text/html; charset=utf-8'
  : name.endsWith('.png')
    ? 'image/png'
    : 'application/json',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  } catch (e) {
    send(res, 400, {error: e.message || '서버 오류'});
  }
}).listen(PORT, () => console.log('SH AI Treasure Hunter on ' + PORT));
