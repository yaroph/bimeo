/* YouVid (server-backed) */
const $ = (s, r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const API = {
  async get(key){ const res = await fetch(`/api/get?key=${encodeURIComponent(key)}`); const j = await res.json(); return j.value },
  async set(key, value){ await fetch('/api/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,value})}); },
  async getStore(){ const res = await fetch('/api/store'); return await res.json(); }
};

async function updateNotifBadge(){
  try{
    if(!State.me) return;
    const trigger = document.querySelector('#topbarRight button[title="Notifications"]');
    if(!trigger) return;
    // fetch last open time
    const notifMap = await API.get('notif') || {};
    const lastOpen = Number(notifMap?.[State.me.id] || 0);

    // gather data
    const users = DB.read('users',[]);
    const videos = DB.read('videos',[]);
    const comments = DB.read('comments',[]);
    const likes = DB.read('likes',{});
    const likeTimes = DB.read('likeTimes',{});
    const subs = DB.read('subs',{});
    let subTimesByChannel = {};
    try{ subTimesByChannel = (await API.get('subsTimes')) || {}; }catch(e){}

    const myVideos = videos.filter(v=>v.channelId===State.me.id);
    const myVideoIds = new Set(myVideos.map(v=>v.id));

    // Count new comments (use grouped latest ts per group similar to UI, but here we just count events)
    let count = 0;

    // Comments on my videos newer than lastOpen
    comments.filter(c=>myVideoIds.has(c.videoId)).forEach(c=>{
      if((Number(c.createdAt)||0) > lastOpen) count += 1;
    });

    // Likes on my videos newer than lastOpen (use likeTimes, fallback to v.createdAt)
    Object.entries(likes).forEach(([vid, LR])=>{
      if(!myVideoIds.has(vid)) return;
      const v = videos.find(x=>x.id===vid);
      const times = likeTimes[vid] || {};
      (LR.likes||[]).forEach(uid=>{
        const ts = Number(times[uid] || (v?.createdAt||0));
        if(ts > lastOpen) count += 1;
      });
    });

    // New videos from subscriptions after sub timestamp and after lastOpen
    const mySubs = subs[State.me.id] || [];
    videos.filter(v=>mySubs.includes(v.channelId)).forEach(v=>{
      const tsSub = ((subTimesByChannel[v.channelId] || {})[State.me.id]) || 0;
      const vtime = Number(v.createdAt || 0);
      if(vtime >= tsSub && vtime > lastOpen) count += 1;
    });

    // New subscribers to my channel (subsTimes for my channel) after lastOpen
    const subsForMe = (subTimesByChannel[State.me.id] || {});
    Object.values(subsForMe).forEach(ts=>{
      if((Number(ts)||0) > lastOpen) count += 1;
    });

    // Update badge
    // Remove any existing
    trigger.querySelector('.notif-badge')?.remove();
    if(count > 0){
      const b = document.createElement('div');
      b.className = 'notif-badge';
      b.textContent = (count>99 ? '99+' : String(count));
      trigger.appendChild(b);
    }
  }catch(e){ /* ignore */ }
}



// --- Avatar helpers: initials-based SVG fallback ---
function _initials(u){
  const f = (u?.prenom||'').trim()[0] || '';
  const l = (u?.nom||'').trim()[0] || ((u?.pseudo||'').trim()[0]||'');
  const s = (f + l || (u?.pseudo||'U')[0] || 'U').toUpperCase();
  return s.slice(0,2);
}
function _colorFromString(s){
  const palette = ['#EF4444','#F59E0B','#10B981','#3B82F6','#8B5CF6','#EC4899','#14B8A6','#F97316','#22C55E','#06B6D4'];
  let h=0; for(let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))>>>0; }
  return palette[h % palette.length];
}
function _svgAvatarDataURL(initials, bg){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'>` +
              `<rect width='100%' height='100%' rx='40' ry='40' fill='${bg}'/>` +
              `<text x='50%' y='54%' font-family='Roboto,Arial,sans-serif' font-weight='700' font-size='32' fill='#fff' text-anchor='middle'>${initials}</text>` +
              `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* === Generic in-page dialogs (alerts / confirms / prompts) === */
function _ensureUiDialog(){
  if (typeof document === 'undefined') return null;
  let dlg = document.getElementById('uiDialog');
  if(!dlg){
    dlg = document.createElement('dialog');
    dlg.id = 'uiDialog';
    dlg.className = 'modal';
    document.body.appendChild(dlg);
  }
  return dlg;
}

function uiAlert(message){
  const dlg = _ensureUiDialog();
  if(!dlg){ console.warn('uiAlert sans dialog', message); return; }
  dlg.innerHTML = `
    <header>
      <strong>Message</strong>
      <button class="icon-button" id="uiDialogClose" title="Fermer">
        <span class="material-symbols-rounded">close</span>
      </button>
    </header>
    <div class="body">
      <p id="uiDialogMessage"></p>
      <div class="actions">
        <button class="btn primary" id="uiDialogOk">OK</button>
      </div>
    </div>`;
  const msgEl = $("#uiDialogMessage", dlg);
  if(msgEl) msgEl.textContent = String(message || '');
  const btnOk = $("#uiDialogOk", dlg);
  const btnClose = $("#uiDialogClose", dlg);
  const close = ()=>{ try{ dlg.close(); }catch(e){} };
  if(btnOk) btnOk.onclick = close;
  if(btnClose) btnClose.onclick = close;
  dlg.addEventListener('cancel', function(ev){
    ev.preventDefault();
    close();
  }, {once:true});
  dlg.showModal();
}

function uiConfirm(message){
  const dlg = _ensureUiDialog();
  if(!dlg){ console.warn('uiConfirm sans dialog', message); return Promise.resolve(false); }
  dlg.innerHTML = `
    <header>
      <strong>Confirmation</strong>
      <button class="icon-button" id="uiDialogClose" title="Fermer">
        <span class="material-symbols-rounded">close</span>
      </button>
    </header>
    <div class="body">
      <p id="uiDialogMessage"></p>
      <div class="actions">
        <button class="btn" id="uiDialogCancel">Annuler</button>
        <button class="btn primary" id="uiDialogConfirm">Confirmer</button>
      </div>
    </div>`;
  const msgEl = $("#uiDialogMessage", dlg);
  if(msgEl) msgEl.textContent = String(message || '');
  return new Promise(function(resolve){
    const btnYes = $("#uiDialogConfirm", dlg);
    const btnNo = $("#uiDialogCancel", dlg);
    const btnClose = $("#uiDialogClose", dlg);
    const close = function(val){
      try{ dlg.close(); }catch(e){}
      resolve(val);
    };
    if(btnYes) btnYes.onclick = function(){ close(true); };
    if(btnNo) btnNo.onclick = function(){ close(false); };
    if(btnClose) btnClose.onclick = function(){ close(false); };
    dlg.addEventListener('cancel', function(ev){
      ev.preventDefault();
      close(false);
    }, {once:true});
    dlg.showModal();
  });
}

function uiPrompt(label, defaultValue, options){
  options = options || {};
  const multiline = !!options.multiline;
  const title = options.title || 'Modification';
  const dlg = _ensureUiDialog();
  if(!dlg){ console.warn('uiPrompt sans dialog', label); return Promise.resolve(defaultValue != null ? defaultValue : ''); }
  const fieldHtml = multiline
    ? `<textarea id="uiPromptInput" rows="4"></textarea>`
    : `<input id="uiPromptInput" type="text">`;
  dlg.innerHTML = `
    <header>
      <strong>${title}</strong>
      <button class="icon-button" id="uiDialogClose" title="Fermer">
        <span class="material-symbols-rounded">close</span>
      </button>
    </header>
    <div class="body">
      <div style="display:flex;flex-direction:column;gap:8px">
        <div id="uiPromptLabel" style="font-size:.95rem;opacity:.8;"></div>
        ${fieldHtml}
      </div>
      <div class="actions">
        <button class="btn" id="uiPromptCancel">Annuler</button>
        <button class="btn primary" id="uiPromptOk">Valider</button>
      </div>
    </div>`;
  const input = $("#uiPromptInput", dlg);
  const labelEl = $("#uiPromptLabel", dlg);
  if(labelEl) labelEl.textContent = String(label || '');
  if(input){
    input.value = defaultValue != null ? String(defaultValue) : '';
    input.focus();
    if(input.select) try{ input.select(); }catch(e){}
  }
  return new Promise(function(resolve){
    const close = function(val){
      try{ dlg.close(); }catch(e){}
      resolve(val);
    };
    const btnOk = $("#uiPromptOk", dlg);
    const btnCancel = $("#uiPromptCancel", dlg);
    const btnClose = $("#uiDialogClose", dlg);
    if(btnOk) btnOk.onclick = function(){ close(input ? input.value : ''); };
    if(btnCancel) btnCancel.onclick = function(){ close(null); };
    if(btnClose) btnClose.onclick = function(){ close(null); };
    dlg.addEventListener('cancel', function(ev){
      ev.preventDefault();
      close(null);
    }, {once:true});
    if(input && !multiline){
      input.addEventListener('keydown', function(ev){
        if(ev.key === 'Enter'){
          ev.preventDefault();
          close(input.value);
        }
      });
    }
    dlg.showModal();
  });
}

/* === end in-page dialog helpers === */
function toast(message){
  uiAlert(message);
}


function avatarSrcOrInitial(u){
  if(u && u.photo){ return u.photo; }
  const initials = _initials(u);
  const bg = _colorFromString(String(u?.id||u?.pseudo||'x'));
  return _svgAvatarDataURL(initials, bg);
}
// --- end helpers ---

const DB = {
  cache: { users:[], videos:[], comments:[], likes:{}, views:{}, subs:{}, sponso:{}, notifications:{} },
  async init(){
    try{ this.cache = await API.getStore(); }catch(e){ console.error('API down?', e); }
    if(!this.cache || !this.cache.users) this.cache = { users:[], videos:[], comments:[], likes:{}, views:{}, subs:{}, sponso:{}, notifications:{} };
    // Seed once if totally empty
    if(this.cache.users.length===0 && this.cache.videos.length===0){
      const u1 = {id:uid(), nom:"Philip", prenom:"", pseudo:"2kliksphilip", tel:"", password:"demo", photo:"", header:""};
      const u2 = {id:uid(), nom:"Sylvain", prenom:"", pseudo:"Sylvain Lye", tel:"", password:"demo", photo:"", header:""};
      this.cache.users = [u1,u2];
      const sample = [
        {title:"Test vidéo 1", url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ", description:"Exemple 1", thumb:"", category:"Video", tags:["test"], channelId:u1.id},
        {title:"Test vidéo 2", url:"https://www.youtube.com/watch?v=oHg5SJYRHA0", description:"Exemple 2", thumb:"", category:"Video", tags:["demo"], channelId:u2.id}
      ];
      sample.forEach(v=>{ v.id=uid(); v.createdAt=Date.now()-Math.floor(Math.random()*86400000*7); const yt=getYouTubeId(v.url); v.thumb= yt?`https://img.youtube.com/vi/${yt}/hqdefault.jpg`:'assets/placeholder.svg'; });
      this.cache.videos = sample;
      await API.set('users', this.cache.users);
      await API.set('videos', this.cache.videos);
      await API.set('comments', []);
      await API.set('likes', {});
      await API.set('views', {});
      await API.set('subs', {});
      await API.set('sponso', {});
      await API.set('notifications', {});
    }
  
    // Ensure default admin user exists & upgrade existing admin if needed
    try{
      const usersArr = this.cache.users || [];
      const existingAdmin = usersArr.find(u => u && u.pseudo === 'admin');
      if(existingAdmin && !existingAdmin.isAdmin){ existingAdmin.isAdmin = true; }
      if(!existingAdmin){
        const adminUser = { id: uid(), nom:'', prenom:'', pseudo:'admin', tel:'', password:'admin', photo:'', header:'', isAdmin: true };
        usersArr.push(adminUser);
        this.cache.users = usersArr;
        await API.set('users', usersArr);
      }
    }catch(e){ console.warn('admin seeding error', e); }
    },
  read(key, def){ return (this.cache?.[key]!==undefined) ? this.cache[key] : def },
  async write(key, val){ this.cache[key]=val; await API.set(key,val); },
  uid: ()=> uid()
};

const State = {
  get me(){ const id = localStorage.getItem('session_user'); if(!id) return null; return DB.read('users', []).find(u=>u.id===id) || null; },
  set me(u){ if(u) localStorage.setItem('session_user', u.id); else localStorage.removeItem('session_user'); },
  users(){ return DB.read('users',[]) },
  async saveUser(u){ const list = DB.read('users',[]); const i=list.findIndex(x=>x.id===u.id); if(i>=0) list[i]=u; else list.push(u); await DB.write('users',list) },
  videos(){ return DB.read('videos',[]) },
  ads(){ return DB.read('ads',[]) },
  async saveAd(a){ const list = DB.read('ads',[]); const i = list.findIndex(x=>x.id===a.id); if(i>=0) list[i]=a; else list.unshift(a); await DB.write('ads', list); },
  async saveVideo(v){ const list = DB.read('videos',[]); const i=list.findIndex(x=>x.id===v.id); if(i>=0) list[i]=v; else list.push(v); await DB.write('videos',list) },
  comments(){ return DB.read('comments',[]) },
  async saveComment(c){ const list = DB.read('comments',[]); list.push(c); await DB.write('comments',list) },
  likeStats(id){ const L = DB.read('likes',{})[id] || {likes:[],dislikes:[]}; return {likes:L.likes.length, dislikes:L.dislikes.length} },
  async toggleLike(vid, uid){
// Toggle like: clicking again removes your like. Also removes any existing dislike.
const likes = DB.read('likes',{});
likes[vid] ??= {likes:[],dislikes:[]};
const L = likes[vid];
const i = Array.isArray(L.likes) ? L.likes.indexOf(uid) : -1;
if (i >= 0){
  // already liked -> remove like
  L.likes.splice(i,1);
} else {
  // add like and remove any dislike
  if (!Array.isArray(L.likes)) L.likes = [];
  if (!Array.isArray(L.dislikes)) L.dislikes = [];
  if (!L.likes.includes(uid)) L.likes.push(uid);
  L.dislikes = L.dislikes.filter(x => x !== uid);
}
await DB.write('likes', likes);
},
  async toggleDislike(vid, uid){
// Toggle dislike: clicking again removes your dislike. Also removes any existing like.
const likes = DB.read('likes',{});
likes[vid] ??= {likes:[],dislikes:[]};
const L = likes[vid];
const i = Array.isArray(L.dislikes) ? L.dislikes.indexOf(uid) : -1;
if (i >= 0){
  // already disliked -> remove dislike
  L.dislikes.splice(i,1);
} else {
  // add dislike and remove any like
  if (!Array.isArray(L.likes)) L.likes = [];
  if (!Array.isArray(L.dislikes)) L.dislikes = [];
  if (!L.dislikes.includes(uid)) L.dislikes.push(uid);
  L.likes = L.likes.filter(x => x !== uid);
}
await DB.write('likes', likes);
},
  views(id){ return DB.read('views',{})[id] || 0 },
  async addView(id){
  try{
    const vids = DB.read('videos',[]) || [];
    const v = vids.find(x=>x.id===id);
    if(v){
      // Skip counting if blocked
      if(v.blocked) return;
      // Skip counting if protected and not unlocked (compared against current pass)
      const currentPass = String(v.visipass || "");
      const _k = "videoUnlocks";
      let unlocks = {};
      try{ unlocks = JSON.parse(localStorage.getItem(_k)||"{}")||{}; }catch(_){}
      const saved = unlocks[id];
      const isUnlocked = saved && String(saved.pass||"") === currentPass;
      if((v.visibilite||"publique")==="protégé" && !isUnlocked) return;
    }
  }catch(e){}
  const views = DB.read('views',{}); views[id] = (views[id]||0) + 1; await DB.write('views', views)
},
  subs(){ return DB.read('subs',{}) },
  subCount(chId){ const s=DB.read('subs',{}); return Object.values(s).reduce((acc,list)=> acc + (Array.isArray(list) && list.includes(chId) ? 1 : 0), 0) },
  isSubbed(chId, uid){ const s=DB.read('subs',{}); return Array.isArray(s?.[uid]) && s[uid].includes(chId) },

  async toggleSub(ch, uid){ const s=DB.read('subs',{}); s[uid] ??= []; if(s[uid].includes(ch)) s[uid]=s[uid].filter(x=>x!==ch); else s[uid].push(ch); await DB.write('subs',s) }
  ,
  // --- Sponsorship helpers ---
  sponso(){ return DB.read('sponso', {}) || {}; },
  isSponsored(videoId){
    try{
      const map = DB.read('sponso', {}) || {};
      const until = Number(map[videoId] || 0);
      return until && until > Date.now();
    }catch(e){ return false; }
  },
  async setSponso(videoId, untilTs){
    const map = DB.read('sponso', {}) || {};
    if(untilTs){ map[videoId] = untilTs; } else { delete map[videoId]; }
    await DB.write('sponso', map);
  }

};

function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36) }
function timeAgo(ts){ const d=Date.now()-ts; const m=Math.floor(d/60000); if(m<60) return `il y a ${m} min`; const h=Math.floor(m/60); if(h<24) return `il y a ${h} h`; const g=Math.floor(h/24); if(g<30) return `il y a ${g} jours`; const mo=Math.floor(g/30); if(mo<12) return `il y a ${mo} mois`; const y=Math.floor(mo/12); return `il y a ${y} an${y>1?'s':''}` }
function getYouTubeId(url){ if(!url) return null; const r=/(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|watch\?v=|v\/))([A-Za-z0-9_-]{6,})/; const m=url.match(r); return m?m[1]:null }
function escapeHtml(s){ return s?.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[m]) || "" }
function formatNumber(n){ if(n>=1_000_000) return (n/1_000_000).toFixed(1).replace('.0','')+' M'; if(n>=1_000) return (n/1_000).toFixed(1).replace('.0','')+' k'; return n.toString() }
function linkify(t){ const url=/((https?:\/\/|www\.)[^\s]+)/g; return t.replace(url, u=>`<a href="${u.startsWith('http')?u:'https://'+u}" target="_blank" rel="noopener">${u}</a>`); }
const $app = ()=>$("#app");

// --- Robust channel user lookup with handle map and case-insensitive matching ---
function userByIdOrHandle(x){
  const users = DB.read('users', []) || [];
  // exact id
  let u = users.find(u=>u.id===x);
  if (u) return u;
  const key = String(x||'').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  // try map
  const map = DB.read('handles', {}) || {};
  const uid = map[lower];
  if (uid){
    u = users.find(u=>u.id===uid);
    if (u) return u;
  }
  // direct handle match (case-insensitive)
  u = users.find(u => (u.handle||'').toLowerCase() === lower);
  if (u) return u;
  // also accept '@handle' form
  if (lower.startsWith('@')){
    const raw = lower.slice(1);
    u = users.find(u => (u.handle||'').toLowerCase() === raw);
    if (u) return u;
    const uid2 = map[raw];
    if (uid2){
      u = users.find(u=>u.id===uid2);
      if (u) return u;
    }
  }
  return null;
}



function userAvatar(u){ return avatarSrcOrInitial(u) }
function getUser(idOrHandle){ return userByIdOrHandle(idOrHandle); }

// Admin check helper
function isAdminUser(u){ if(!u) return false; const p=(u.pseudo||'').toLowerCase(); return !!(u.isAdmin || u.role==='admin' || p==='admin'); }


function updateSidebarAuth(){
  try{
    const subsLink = document.querySelector('#sidebar a[data-nav="subs"]');
    if(!subsLink) return;
    if(State.me){
      subsLink.style.display = '';
    }else{
      subsLink.style.display = 'none';
    }
  }catch(e){}
}

/* UI Topbar */
async function renderTopbar(){
  const right=$("#topbarRight"); right.innerHTML="";
  updateSidebarAuth();
  if(State.me){
    right.append(btnIcon("upload","Poster",openPostModal), btnIcon("video_library","Mes vidéos",()=>navigate('#/myvideos')), btnIcon("notifications","Notifications",openNotifMenu));
    // Admin-only "Publicité" button
    if(isAdminUser(State.me)){
      const adsBtn = btnOutlined('Publicité', ()=>{ navigate('#/ads'); });
      adsBtn.classList.add('orange');
      right.append(adsBtn);
    }

    const avatar = document.createElement('button');
    avatar.className='icon-button';
    avatar.id='profileBtn';
    avatar.innerHTML = `<img src="${avatarSrcOrInitial(State.me)}" alt="profil" style="width:32px;height:32px;border-radius:50%;object-fit:cover">`;
    avatar.title='Profil';
    avatar.addEventListener('click', (e)=>{ e.stopPropagation(); openProfileMenu(); });
    right.append(avatar);
  }else{
    right.append(btnOutlined("Créer un compte", ()=>openAuthModal('register')), btnPrimary("Connexion", ()=>openAuthModal('login')));
  }

  try{ await updateNotifBadge(); }catch(e){}
}

function btnPrimary(t,on){ const b=document.createElement('button'); b.className='btn primary'; b.textContent=t; b.onclick=on; return b }
function btnOutlined(t,on){ const b=document.createElement('button'); b.className='btn'; b.textContent=t; b.onclick=on; return b }
function btnIcon(i,t,on){
  const b=document.createElement('button');
  b.className='icon-button';
  if(t!=="Profil" && t) b.title=t;
  b.innerHTML=`<span class="material-symbols-rounded">${i}</span>`;
  if(t==="Profil") b.id='profileBtn';
  if(typeof on==='function') b.onclick=on;
  return b;
}

/* Modals */




function openProfileMenu(){
  if(!State.me) return openAuthModal('login');
  const old = document.querySelector('.menu-flyout'); if(old) old.remove();
  const me = State.me;
  const box = document.createElement('div');
  box.className = 'menu-flyout';
  box.innerHTML = `
    <div class="menu-header">
      <img class="menu-avatar" src="${avatarSrcOrInitial(me)}" alt="avatar">
      <div class="menu-id">
        <div class="menu-name">${[me.prenom, me.nom].filter(Boolean).join(' ') || me.pseudo || 'Utilisateur'}</div>
        <div class="menu-pseudo">@${(me.pseudo||'user').toString()}</div>
      </div>
    </div>
    <div class="menu-sep"></div>
    <div class="menu-item" id="mi-videos"><span class="material-symbols-rounded">video_library</span> Mes videos</div>
    <div class="menu-item" id="mi-edit-profile" data-nav="#/profile/edit"><span class="material-symbols-rounded">edit</span> Modifier le profil</div>
    <div class="menu-item" id="mi-my-channel"><span class="material-symbols-rounded">account_circle</span> Acceder a sa chaine</div>
    <div class="menu-item" id="mi-logout"><span class="material-symbols-rounded">logout</span> Se déconnecter</div>
  `;
  document.body.appendChild(box);

  // Click handlers for menu itemsbox.querySelector('#mi-logout').onclick=()=>{ State.me=null; renderTopbar(); route(); box.remove(); };

  // Positioning: anchor to profile button and clamp inside viewport
  const btn = document.querySelector('#profileBtn');
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bw = box.offsetWidth;
  const bh = box.offsetHeight;
  let left = margin, top = margin;
  if(btn){
    const r = btn.getBoundingClientRect();
    left = Math.min(Math.max(margin, r.right - bw), vw - bw - margin);
    top = r.bottom + margin;
    // If overflowing bottom, flip above the button
    if(top + bh > vh - margin){
      top = Math.max(margin, r.top - bh - margin);
    }
  }else{
    // Fallback center
    left = Math.max(margin, (vw - bw)/2);
    top = Math.max(margin, (vh - bh)/2);
  }
  // New positioning: align menu header with top header and back-to-back with Profil button
  (function(){
    const vw = window.innerWidth, vh = window.innerHeight;
    const header = document.querySelector('#topbar') || document.querySelector('.topbar') || document.querySelector('header');
    const trigger = document.querySelector('#topbarRight button[title="Profil"]');
    const bw = box.offsetWidth || 260; // fallback to CSS width
    const bh = box.offsetHeight || 200; // approximate if not rendered yet

    let top = 0;
    if(header){
      const hr = header.getBoundingClientRect();
      top = Math.max(0, hr.bottom); // sit just below the top header
    }else{
      top = 0;
    }

    let rightPx = 0;
    if(trigger){
      const r = trigger.getBoundingClientRect();
      // distance from trigger's right edge to viewport right edge
      rightPx = Math.max(0, vw - r.right);
      // shift a few pixels left so the flyout's "back" lines up with the button's "back"
      rightPx = rightPx + 6; // tweak offset (6px)
    }else{
      // fallback: keep a small gutter
      rightPx = 6;
    }

    // Apply
    box.style.left = 'auto';
    box.style.right = rightPx + 'px';
    box.style.top = top + 'px';
  })();

  // Actions
  var __v=document.querySelector('#mi-videos'); if(__v) __v.onclick = ()=>{ navigate('#/myvideos'); box.remove(); };
  var __e=document.querySelector('#mi-edit-profile'); if(__e) __e.onclick = ()=>{ navigate('#/profile/edit'); box.remove(); };
  var __m=document.querySelector('#mi-my-channel'); if(__m) __m.onclick = ()=>{ navigate(`#/channel/${State.me.handle||State.me.id}`); box.remove(); };
  $("#mi-logout").onclick = ()=>{ State.me=null; renderTopbar(); route(); box.remove(); };

  // Close on outside click
  setTimeout(()=>{
    const close=(e)=>{ const t=e.target; const isTrigger = t && (t.id==='profileBtn' || (t.closest && t.closest('#profileBtn'))); if(!box.contains(t) && !isTrigger){ box.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  },0);
}

function openAuthModal(mode='login'){
  const dlg=$("#authModal"); const isLogin=mode==='login';
  dlg.innerHTML = `
  <header><strong>${isLogin?'Connexion':'crée un compte'}</strong><button class="icon-button" onclick="this.closest('dialog').close()"><span class="material-symbols-rounded">close</span></div></header>
  <div class="body">
    ${isLogin?`
      <form id="loginForm" class="gridform">
        <input name="pseudo" placeholder="Pseudo" required>
        <input name="password" placeholder="Mot de passe" type="password" required>
        <div></div><button class="btn primary">Se connecter</div>
      </form>`:`
      <form id="registerForm" class="gridform">
  <div class="col-span-2" style="display:flex;flex-direction:column;align-items:center;gap:10px">
    <img id="regAvatarPreview" src="assets/placeholder.svg" alt="Avatar" class="avatar-img">
    <input name="photo" placeholder="Lien photo de profil" class="small-input">
  </div>
  <input name="nom" placeholder="Nom" required>
  <input name="prenom" placeholder="Prénom" required>
  <input name="pseudo" placeholder="Pseudo" class="col-span-2" required>
  <input name="tel" placeholder="Numéro de téléphone">
  <input name="iban" placeholder="Numéro de compte en banque">
  <input name="password" placeholder="Mot de passe" type="password" class="col-span-2" required>
  <div class="actions col-span-2">
    <button type="button" class="btn" id="btn-cancel">Annuler</button>
    <button class="btn primary" id="btn-create" disabled>Créer la chaîne</button>
  </div>
</form>`}
  </div>`;
  if(isLogin){
    $("#loginForm", dlg).onsubmit = (e)=>{
      e.preventDefault(); const pseudo=e.target.pseudo.value.trim(); const pass=e.target.password.value;
      const u = State.users().find(x=>x.pseudo===pseudo && x.password===pass);
      if(u){ State.me=u; renderTopbar(); dlg.close(); route(); } else uiAlert("Identifiants invalides.");
    }
  }else{
    $("#registerForm", dlg).onsubmit = async (e)=>{
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const u = { id: uid(), ...fd, createdAt: Date.now() };
      await State.saveUser(u); State.me=u; renderTopbar(); dlg.close(); route();
    }
    // --- dynamic avatar + button enable ---
    const regForm = $("#registerForm", dlg);
    const btnCreate = $("#btn-create", dlg);
    const btnCancel = $("#btn-cancel", dlg);
    const preview = $("#regAvatarPreview", dlg);
    const photoInput = regForm.elements["photo"];
    const requiredInputs = [regForm.elements["nom"], regForm.elements["prenom"], regForm.elements["pseudo"], regForm.elements["password"]];
    function initialsAvatar(){
      const tmp = { nom: regForm.elements["nom"].value, prenom: regForm.elements["prenom"].value, pseudo: regForm.elements["pseudo"].value };
      const initials = _initials(tmp);
      const bg = _colorFromString(String(tmp.pseudo||tmp.nom||tmp.prenom||'x'));
      return _svgAvatarDataURL(initials, bg);
    }
    function updateAvatar(){
      const url = (photoInput.value||'').trim();
      if(url && /^https?:\/\//i.test(url)){
        const img = new Image();
        img.onload = () => { preview.src = url; };
        img.onerror = () => { preview.src = initialsAvatar(); };
        img.src = url;
      }else{
        preview.src = initialsAvatar();
      }
    }
    function updateBtn(){
      const ok = requiredInputs.every(inp => (inp && (inp.value||'').trim().length>0));
      btnCreate.disabled = !ok;
    }
    ["input","change"].forEach(ev=>{
      ["nom","prenom","pseudo","password","photo"].forEach(name=>{
        const el = regForm.elements[name];
        if(el){ el.addEventListener(ev, ()=>{ updateAvatar(); updateBtn(); }); }
      });
    });
    if(btnCancel){ btnCancel.addEventListener('click', ()=> dlg.close()); }
    updateAvatar(); updateBtn();

  }
  dlg.showModal();
}


function openPostModal(){
  if(!State.me) return openAuthModal('login');
  const dlg=$("#postModal");
  // Modal UI
  dlg.innerHTML = `
    <header class="pm-header">
      <div class="pm-title"><strong>Poster une vidéo</strong></div>
      <button class="icon-button pm-close" title="Fermer"><span class="material-symbols-rounded">close</span></button>
    </header>
    <div class="pm-sep"></div>

    <div class="pm-toplink">
      <input id="pm-url" class="pm-url-input" type="url" placeholder="Lien de la vidéo YouTube, ou copié depuis le téléphone ingame">
    </div>

    <div class="pm-body">
      <div class="pm-left">
        <label class="pm-label">Titre</label>
        <input id="pm-title" type="text" placeholder="Titre (laisse vide pour utiliser le titre YouTube)">

        <label class="pm-label">Description <span class="pm-optional">(optionnel)</span></label>
        <textarea id="pm-desc" rows="5" placeholder="Présentez votre vidéo à vos spectateurs (saisissez @ pour mentionner une chaîne)"></textarea>

        <label class="pm-label">Miniature</label>
        <input id="pm-thumb" type="url" placeholder="Lien de la miniature (goopics, etc.)">

        <label class="pm-label">Catégorie</label>
        <select id="pm-category"><option value="Video">Video</option><option value="Short">Short</option><option value="News">News</option><option value="Fiction">Fiction</option><option value="Musique">Musique</option></select>

        <label class="pm-label">Visibilité</label>
        <select id="pm-visibility">
          <option value="publique">publique</option>
          <option value="privé">privé</option>
          <option value="protégé">protégé</option>
        </select>
        <div id="pm-visi-pass-wrap" class="pm-visi-pass hidden">
          <label class="pm-label small">Mot de passe</label>
          <input id="pm-visi-pass" type="text" placeholder="Mot de passe (requis pour 'protégé')">
        </div>
        

        <label class="pm-label">Tags</label>
        <input id="pm-tags" type="text" placeholder="Tags séparé par une virgule">
      </div>

      <div class="pm-right">
        <div class="pm-details-title">Détails</div>
        <div class="pm-preview">
          <div class="pm-thumb-rect" id="pm-thumb-rect"></div>
          <div class="pm-vname-label">nom de la video :</div>
          <div class="pm-vname" id="pm-vname">—</div>
        </div>
      </div>
    </div>

    <div class="pm-sep"></div>
    <div class="pm-footer">
      <button class="btn primary" id="pm-submit">Poster la vidéo</button>
    </div>
  `;

  // Wire close & show dialog
  $(".pm-close", dlg).onclick = ()=> dlg.close();
  
  // Toggle password field for "protégé"
  try{
    const sel = $("#pm-visibility", dlg);
    const wrap = $("#pm-visi-pass-wrap", dlg);
    if(sel && wrap){
      const updateVisi = ()=>{ wrap.classList.toggle('hidden', sel.value!=="protégé"); };
      sel.addEventListener('change', updateVisi);
      updateVisi();
    }
  }catch(e){}dlg.showModal();

  // State
  let derivedTitle = "";
  let derivedThumb = null;

  const $url = $("#pm-url", dlg);
  const $title = $("#pm-title", dlg);
  const $thumb = $("#pm-thumb", dlg);
  const $vname = $("#pm-vname", dlg);
  const $thumbRect = $("#pm-thumb-rect", dlg);

  function updatePreview(){
    const t = ($title.value || derivedTitle || "").trim();
    $vname.textContent = t || "—";
    // thumb precedence: explicit miniature > url inferred > placeholder
    const explicit = $thumb.value.trim();
    const src = explicit || derivedThumb || "";
    if(src){
      $thumbRect.style.backgroundImage = `url("${src}")`;
      $thumbRect.classList.add("has-img");
    }else{
      $thumbRect.style.backgroundImage = "";
      $thumbRect.classList.remove("has-img");
    }
  }

  async function deriveFromUrl(u){
    derivedThumb = null; derivedTitle = "";
    if(!u) { updatePreview(); return; }
    const ytId = getYouTubeId(u);
    if(ytId){
      derivedThumb = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
      try{
        // Try to fetch YouTube oEmbed for title
        const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`);
        if(o.ok){ const j = await o.json(); if(j && j.title) derivedTitle = j.title; }
      }catch(e){ /* ignore CORS/network errors */ }
    }else{
      
// Try to capture the first frame as thumbnail for non-YouTube URLs
try{
  const vEl = document.createElement('video');
  vEl.crossOrigin = 'anonymous';
  vEl.muted = true;
  vEl.preload = 'auto';
  vEl.src = u;
  await new Promise((resolve, reject)=>{
    const onMeta = ()=>{
      try{
        vEl.currentTime = 0;
      }catch(e){ /* ignore */ }
    };
    const onSeeked = ()=>{
      try{
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, vEl.videoWidth||640);
        canvas.height = Math.max(1, vEl.videoHeight||360);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(vEl, 0, 0, canvas.width, canvas.height);
        try{
          derivedThumb = canvas.toDataURL('image/jpeg', 0.8);
        }catch(e){ /* canvas tainted (CORS), ignore */ }
      }catch(e){ /* ignore */ }
      resolve();
    };
    vEl.addEventListener('loadedmetadata', onMeta, {once:true});
    vEl.addEventListener('seeked', onSeeked, {once:true});
    vEl.addEventListener('error', ()=>resolve(), {once:true});
  });
}catch(e){ /* ignore */ }
// Fallback: try to use filename as title
      try{
        const urlObj = new URL(u);
        const path = urlObj.pathname.split("/").pop();
        const name = path?.split(".").slice(0,-1).join(".") || path || "";
        derivedTitle = name.replace(/[_\-]+/g," ").trim();
      }catch(e){}
  }
    updatePreview();
  }

  // Events
  $url.addEventListener('input', e=> deriveFromUrl(e.target.value));
  $title.addEventListener('input', updatePreview);
  $thumb.addEventListener('input', updatePreview);

  // Submit handler
  $("#pm-submit", dlg).onclick = async ()=>{
    const url = $url.value.trim();
    if(!url){ uiAlert("Merci d'entrer le lien de la vidéo."); return; }
    const title = ($title.value || derivedTitle || "Sans titre").trim();
    const description = $("#pm-desc", dlg).value.trim(); // optional
    const category = $("#pm-category", dlg).value;
    const visibility = ($("#pm-visibility", dlg)?.value || "publique");
    const visipass = (visibility==="protégé") ? ($("#pm-visi-pass", dlg)?.value||"") : "";const tags = $("#pm-tags", dlg).value.split(",").map(s=>s.trim()).filter(Boolean);
    const thumbUrl = ($("#pm-thumb", dlg).value.trim() || derivedThumb || 'assets/placeholder.svg');

    // Create video object compatible with existing DB
    const ytId = getYouTubeId(url);
    const video = {
      id: uid(),
      title,
      description,
      category,
      tags,
      url,
      ytId,
      thumb: thumbUrl,
      channelId: State.me.id,
      createdAt: Date.now(),
      visibilite: visibility, visipass: visipass, views: 0, likes: 0,
    };

    DB.write('videos', [video, ...DB.read('videos', [])]);
    dlg.close();
    toast("Vidéo postée !");
    navigate('#/myvideos');
  };
}


function openNotifModal(){
  const dlg=$("#notifModal"); const me=State.me; const notes = DB.read('notifications',{}); const list = me?(notes[me.id]||[]):[];
  dlg.innerHTML = `<header><strong>Notifications</strong><button class="icon-button" onclick="this.closest('dialog').close()"><span class="material-symbols-rounded">close</span></div></header>
  <div class="body">${list.length?list.map(n=>`<div class="chip">${n}</div>`).join(''):'Aucune notification'}</div>`;
  dlg.showModal();
}



async function openNotifMenu(){
  if(!State.me) return openAuthModal('login');
  try{ await API.set('notif', { userId: State.me.id, ts: Date.now() }); }catch(e){}; try{ await updateNotifBadge(); }catch(_){ }

  if(!State.me) return openAuthModal('login');
  // remove any existing flyouts
  const old = document.querySelector('.notif-flyout'); if(old) old.remove();
  const oldMenu = document.querySelector('.menu-flyout'); if(oldMenu) oldMenu.remove();

  const me = State.me;
  const box = document.createElement('div');
  box.className = 'notif-flyout';
  box.innerHTML = `<header>Notifications</header><div class="notif-list" id="notifList"></div>`;
  document.body.appendChild(box);

  // Click handlers for menu itemsbox.querySelector('#mi-logout').onclick=()=>{ State.me=null; renderTopbar(); route(); box.remove(); };

  const users = DB.read('users',[]);
  const videos = DB.read('videos',[]);
  const comments = DB.read('comments',[]);
  const likes = DB.read('likes',{});
  const likeTimes = DB.read('likeTimes',{}); // { [videoId]: { [userId]: timestamp } }
  const subs = DB.read('subs',{});

  const myVideos = videos.filter(v=>v.channelId===me.id);
  const myVideoIds = new Set(myVideos.map(v=>v.id));
  const byVid = Object.fromEntries(videos.map(v=>[v.id,v]));
  const byUser = (id)=>users.find(u=>u.id===id) || null;

  const items = [];
  // --- New subscribers (who subscribed to my channel) ---
  let subTimesByChannel = {};
  try{ subTimesByChannel = (await API.get('subsTimes')) || {}; }catch(e){ subTimesByChannel = {}; }
  const subsForMe = subTimesByChannel[me.id] || {};
  Object.entries(subsForMe).forEach(([uid, ts])=>{
    const who = byUser(uid);
    items.push({
      ts: Number(ts)||0,
      href: `#/channel/${uid}`,
      text: `<span class="who">${escapeHtml(who?.pseudo || who?.nom || 'Quelqu\'un')}</span> s'est abonné(e) à votre chaîne`,
      avatar: userAvatar(who),
      thumb: (who && (who.header||who.cover)) || 'assets/placeholder.svg'
    });
  });


  /* -------- Grouped comments on my videos (within 1h) -------- */
  const ONE_HOUR = 3600*1000;
  const commentsOnMine = comments.filter(c=>myVideoIds.has(c.videoId)).sort((a,b)=>a.createdAt-b.createdAt);
  // group by video with 1-hour buckets
  const bucketsByVid = {};
  commentsOnMine.forEach(c=>{
    const key = c.videoId;
    bucketsByVid[key] = bucketsByVid[key] || [];
    const arr = bucketsByVid[key];
    const last = arr[arr.length-1];
    if(last && (c.createdAt - last.ts0) <= ONE_HOUR){
      last.users.push(c.userId);
      last.tsLast = c.createdAt;
    }else{
      arr.push({ ts0:c.createdAt, tsLast:c.createdAt, firstUser:c.userId, users:[c.userId] });
    }
  });
  Object.entries(bucketsByVid).forEach(([vid, groups])=>{
    const v = byVid[vid]; if(!v) return;
    groups.forEach(g=>{
      const first = byUser(g.firstUser);
      const extra = Math.max(0, new Set(g.users).size - 1);
      const who = first?.pseudo || first?.nom || 'Quelqu\'un';
      const text = extra>0 ? `${who} & ${extra} personne${extra>1?'s':''} ont commenté votre vidéo <strong>${escapeHtml(v.title||'')}</strong>`
                           : `${who} a commenté votre vidéo <strong>${escapeHtml(v.title||'')}</strong>`;
      items.push({
        ts: g.tsLast,
        href: `#/video/${v.id}`,
        text,
        avatar: userAvatar(first),
        thumb: v.thumb || 'assets/placeholder.svg'
      });
    });
  });

  /* -------- New videos from subscriptions -------- */
  const mySubs = subs[me.id] || [];
  videos
    .filter(v => mySubs.includes(v.channelId))
    .forEach(v => {
      // Only show videos posted AFTER the time I subscribed to that channel
      const tsSub = ((subTimesByChannel[v.channelId] || {})[me.id]) || 0;
      const vtime = Number(v.createdAt || 0);
      if (vtime < tsSub) return; // skip older videos
      const ch = byUser(v.channelId);
      items.push({
        ts: vtime,
        href: `#/video/${v.id}`,
        text: `<span class="who">${ch?.pseudo || ch?.nom || 'Un abonné'}</span> a mis en ligne <strong>${escapeHtml(v.title||'')}</strong>`,
        avatar: userAvatar(ch),
        thumb: v.thumb || 'assets/placeholder.svg'
      });
    });
/* -------- Grouped likes on my videos (within 1h using likeTimes) -------- */
  const likesOnMine = Object.entries(likes).filter(([vid,_])=>myVideoIds.has(vid));
  likesOnMine.forEach(([vid, LR])=>{
    const v = byVid[vid]; if(!v) return;
    const times = likeTimes[vid] || {};
    // Build like events with timestamps (fallback to video time if missing)
    const likeEvents = (LR.likes||[]).map(uid=>({uid, ts: times[uid] || v.createdAt || Date.now()}))
      .sort((a,b)=>a.ts-b.ts);
    // bucket by 1h
    const buckets=[];
    likeEvents.forEach(e=>{
      const last=buckets[buckets.length-1];
      if(last && (e.ts - last.ts0) <= ONE_HOUR){
        last.users.push(e.uid);
        last.tsLast = e.ts;
      }else{
        buckets.push({ ts0:e.ts, tsLast:e.ts, firstUser:e.uid, users:[e.uid] });
      }
    });
    buckets.forEach(g=>{
      const first = byUser(g.firstUser);
      const extra = Math.max(0, new Set(g.users).size - 1);
      const who = first?.pseudo || first?.nom || 'Quelqu\'un';
      const text = extra>0 ? `${who} & ${extra} personne${extra>1?'s':''} ont liké votre vidéo <strong>${escapeHtml(v.title||'')}</strong>`
                           : `${who} a liké votre vidéo <strong>${escapeHtml(v.title||'')}</strong>`;
      items.push({
        ts: g.tsLast,
        href: `#/video/${v.id}`,
        text,
        avatar: userAvatar(first),
        thumb: v.thumb || 'assets/placeholder.svg'
      });
    });
  });

  // Do NOT include legacy text notifications like "Nouveau commentaire sur ..."

  // Sort: newest first
  items.sort((a,b)=>b.ts - a.ts);

  const list = box.querySelector('#notifList');
  if(items.length===0){
    list.innerHTML = `<div class="notif-empty">Aucune notification</div>`;
  }else{
    list.innerHTML = items.slice(0,10).map(it=>`
      <a class="notif-item" href="${it.href}" onclick="document.querySelector('.notif-flyout')?.remove()">
        <img class="notif-avatar" src="${it.avatar}" alt="avatar">
        <div class="notif-text">${it.text}<div class="notif-time">${timeAgo(it.ts)}</div></div>
        <img class="notif-thumb" src="${it.thumb}" alt="miniature">
      </a>`).join('');
  }

  // Position the flyout under the bell icon
  const trigger = document.querySelector('#topbarRight button[title="Notifications"]');
  const r = trigger?.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const bw = box.offsetWidth || 420;
  const bh = Math.min( box.offsetHeight || 400, vh - 16 );
  const margin = 8;
  let left = vw - bw - margin;
  let top = (r ? r.bottom + margin : 56 + margin);
  if(r && top + bh > vh - margin){ top = Math.max(margin, r.top - bh - margin); }
  box.style.left = left + 'px';
  box.style.top = top + 'px';

  // Close on outside click or ESC
  function closeFlyout(ev){
    if(ev.type==='keydown' && ev.key!=='Escape') return;
    if(ev.type==='click' && box.contains(ev.target)) return;
    box.remove();
    window.removeEventListener('click', closeFlyout, true);
    window.removeEventListener('keydown', closeFlyout, true);
  }
  setTimeout(()=>{
    window.addEventListener('click', closeFlyout, true);
    window.addEventListener('keydown', closeFlyout, true);
  }, 0);
}



// Patch: record timestamps for like events to enable grouping
if(!State.__likePatched){
  const origLike = State.toggleLike?.bind(State);
  if(origLike){
    State.toggleLike = async (vid, uid) => {
      await origLike(vid, uid);
      const after = DB.read('likes',{});
      const L = after[vid];
      if(L && L.likes && L.likes.includes(uid)){
        const T = DB.read('likeTimes',{});
        if(!T[vid]) T[vid] = {};
        T[vid][uid] = Date.now();
        await DB.write('likeTimes', T);
      }else{
        // If unliked, remove timestamp
        const T = DB.read('likeTimes',{});
        if(T[vid] && T[vid][uid]){ delete T[vid][uid]; await DB.write('likeTimes', T); }
      }
    }
  }
  State.__likePatched = true;
}



/* === Avatar + text helpers === */
function userInitials(u){
  const p = (u?.prenom||'').trim();
  const n = (u?.nom||'').trim();
  const pseudo = (u?.pseudo||'').trim();
  let a = '';
  if(p || n){
    a = (p[0]||'') + (n[0]||'');
  }else if(pseudo){
    const parts = pseudo.split(/\s+/);
    a = (parts[0]?.[0]||'') + (parts[1]?.[0]||parts[0]?.[1]||'');
  }
  a = a.toUpperCase().slice(0,2);
  if(!a) a = 'U';
  return a;
}
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return Math.abs(h); }
const AVATAR_COLORS = ['#EF4444','#F59E0B','#10B981','#3B82F6','#6366F1','#8B5CF6','#EC4899','#14B8A6','#22C55E','#EAB308'];
function colorForUser(u){
  const key = (u?.id||'') + '|' + (u?.pseudo||'') + '|' + (u?.prenom||'') + '|' + (u?.nom||'');
  const idx = hashStr(key) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}
function makeAvatarElement(u, sizePx){
  const hasPhoto = !!(u && u.photo);
  if(hasPhoto){
    const img = document.createElement('img');
    img.src = u.photo;
    img.alt = 'avatar';
    img.style.width = sizePx+'px';
    img.style.height = sizePx+'px';
    img.style.borderRadius = '50%';
    img.style.objectFit = 'cover';
    return img;
  }
  const div = document.createElement('div');
  div.className = 'avatar-initial';
  div.textContent = userInitials(u);
  div.style.width = sizePx+'px';
  div.style.height = sizePx+'px';
  div.style.borderRadius = '50%';
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.justifyContent = 'center';
  div.style.fontWeight = '700';
  div.style.color = '#fff';
  div.style.background = colorForUser(u);
  // scale font roughly to size
  div.style.fontSize = (sizePx*0.42) + 'px';
  return div;
}

/* Clickable helper */
function makeClickable(el, href){
  if(!el) return;
  el.style.cursor = 'pointer';
  el.setAttribute('data-href', href);
  el.setAttribute('role','link');
  try{ el.tabIndex = 0 }catch(_){}
  const go = ()=> navigate(href);
  el.addEventListener('click', (e)=>{
    // Don't hijack native <a> clicks inside
    if(e.target.closest && e.target.closest('a')) return;
    go();
  });
  el.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){
      e.preventDefault(); go();
    }
  });
}
/* Routing */
function navigate(hash){ location.hash = hash 
  try{ updateNotifBadge(); }catch(e){}
}
window.addEventListener('hashchange', ()=>{ try{ route(); }catch(e){} try{ updateNotifBadge(); }catch(e){} });
$("#menuBtn").onclick = ()=> $("#sidebar").classList.toggle("open");
$("#searchForm").onsubmit = (e)=>{ e.preventDefault(); const q=$("#searchInput").value.trim(); navigate(q?`#/search/${encodeURIComponent(q)}`:'#/') }

async function route(){

  // Admin Ads route
  if(location.hash === '#/ads'){
    if(!isAdminUser(State.me)){ navigate('#/'); return; }
    const app = document.getElementById('app');
    const ads = State.ads();
    app.innerHTML = `
      <div class="container">
        <div class="ads-header">
          <div class="title-xl">Gestion des publicités</div>
          <button class="btn orange" id="ads-add">Ajouter une publicité</button>
        </div>
        <div id="ads-list" class="ads-list"></div>
      </div>
    `;
    $("#ads-add").onclick = ()=> openAdsModal(null);

    const wrap = $("#ads-list");
    // Header
    const head = document.createElement('div');
    head.className = 'ads-row head';
    head.innerHTML = `
      <div class="col-thumb muted">MINIATURE</div>
      <div class="col-title muted">TITRE</div>
      <div class="col-date muted">DATE</div>
      <div class="col-views muted">VUES</div>
      <div class="col-until muted">ACTIVE JUSQU'À</div>
    `;
    wrap.appendChild(head);

    if(!ads.length){
      const empty = document.createElement('div');
      empty.className='muted';
      empty.style.margin='12px 0';
      empty.textContent="Aucune publicité pour le moment. Cliquez sur \"Ajouter une publicité\".";
      wrap.appendChild(empty);
      return;
    }
    ads.sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
    ads.forEach(ad=>{
      const until = ad.activeUntil ? new Date(ad.activeUntil).toLocaleDateString('fr-FR') : "—";
      const created = ad.createdAt ? new Date(ad.createdAt).toLocaleDateString('fr-FR') : "—";
      const row = document.createElement('div');
      row.className = 'ads-row card clickable';
      row.innerHTML = `
        <div class="col-thumb">
          <img src="${ad.thumb||'assets/placeholder.svg'}" style="width:120px;height:68px;object-fit:cover;border-radius:8px">
        </div>
        <div class="col-title">
          <div class="title">${escapeHtml(ad.title||'Sans titre')}</div>
          <div class="muted small">${ad.createdFor ? `Créé pour : ${escapeHtml(ad.createdFor)}` : ''}</div>
          <div class="muted small">${escapeHtml((ad.desc||'').toString())}</div>
        </div>
        <div class="col-date">${created}</div>
        <div class="col-views">${ad.views||0}</div>
        <div class="col-until">${until}</div>
      `;
      row.onclick = ()=> openAdsModal(ad);
      wrap.appendChild(row);
    });
    return;
  }

// Sidebar size rules
const side = $("#sidebar");
if(side){
  const [_, page] = location.hash.split('/');
  const largePages = new Set(['', '#', '#/', 'trending', 'subs', 'search', 'category', 'channel']);
  // Not mini (large) on listed pages, mini otherwise (e.g., video)
  const isLarge = largePages.has(page) || location.hash === "" || location.hash === "#/";
  side.classList.toggle("mini", !isLarge);
}

  const [_, page, p2] = location.hash.split('/');
  if(page==='podium'){ const sEl = $("#sidebar"); if(sEl) sEl.classList.remove('mini'); }
  if(!page) return viewHome();
  switch(page){
    case 'trending': return viewTrending();
    case 'podium': return viewPodium();
    case 'subs': return viewSubs();
    case 'category': return viewCategory(decodeURIComponent(p2));
    case 'video': return viewVideo(p2);
    case 'channel': return viewChannel(decodeURIComponent(p2||''));
    case 'profile': if(p2==='edit') return viewEditProfile();
    case 'search': return viewSearch(decodeURIComponent(p2));
    case 'myvideos': return viewMyVideos();
    default: return viewHome();
  }
}

/* Views */
function videoGrid(videos, title, opts){
  const app=$app(); app.innerHTML="";
  const h=document.createElement('div'); h.innerHTML=`<div class="section-title">${title}</div>`; app.appendChild(h);
  const grid=document.createElement('div'); grid.className="grid"; app.appendChild(grid);
  if(!videos.length){ grid.outerHTML=`<div class="feed-empty">Rien à afficher.</div>`; return }
  
  // Visibility filtering
  try{
    const hash = String(location.hash||'#/');
    const onChannel = /^#\/channel\//.test(hash);
    const onSubs = /^#\/subs/.test(hash);
    const me = State.me;
    const subsMap = DB.read('subs',{}) || {};
    const mySubs = me ? (subsMap[me.id] || []) : [];
    videos = videos.filter(v => {
      const vis = (v.visibilite || "publique");
      if(vis === "publique") return true;
      if(vis === "privé" || vis === "protégé"){
        if(onChannel || onSubs){
          return me && Array.isArray(mySubs) && mySubs.includes(v.channelId);
        }
        return false;
      }
      return true;
    });
    if(!videos.length){ grid.outerHTML=`<div class="feed-empty">Rien à afficher.</div>`; return }
  }catch(e){}let list = (opts && opts.prioritizeSponsored===false) ? videos.slice() : videos.slice().sort((a,b)=> (State.isSponsored(b.id)-State.isSponsored(a.id)));
  if(opts && typeof opts.limit==='number'){ list = list.slice(0, opts.limit); }
  list.forEach(v=> grid.appendChild(videoCard(v)));
}


function channelRow(u){
  const tpl = $("#channelRowTemplate").content.cloneNode(true);
  tpl.querySelector('.avatar').src = avatarSrcOrInitial(u);
  tpl.querySelector('.avatar').alt = u.pseudo || u.nom || 'Compte';
  tpl.querySelector('.avatar-link').href = `#/channel/${u.handle||u.id}`;
  tpl.querySelector('.name').textContent = u.pseudo || u.nom || 'Compte';
  tpl.querySelector('.name').href = `#/channel/${u.handle||u.id}`;
  try {
    tpl.querySelector('.stats').textContent = `${formatNumber(State.subCount(u.id))} abonnés • ${DB.read('videos',[]).filter(v=>v.channelId===u.id).length} vidéos`;
  } catch(e) {
    tpl.querySelector('.stats').textContent = '';
  }
  if(tpl.querySelector('.desc')) tpl.querySelector('.desc').textContent = (u.bio || '').trim();
  tpl.querySelector('.goto').href = `#/channel/${u.handle||u.id}`;
  const root = tpl.firstElementChild; makeClickable(root, `#/channel/${u.handle||u.id}`); return tpl;
}


function videoRow(v){
  const tpl = $("#videoRowTemplate").content.cloneNode(true);
  const ch = getUser(v.channelId);
  const thumb = tpl.querySelector('.thumb'); thumb.src = v.thumb; thumb.alt = v.title;
  tpl.querySelector('.thumb-link').href = `#/video/${v.id}`;
  const title = tpl.querySelector('.title'); title.textContent = v.title; title.href = `#/video/${v.id}`;
  const chan = tpl.querySelector('.chan'); chan.textContent = ch?.pseudo || 'Utilisateur'; chan.href = `#/channel/${ch?.id}`;
  tpl.querySelector('.stats').textContent = `${formatNumber(State.views(v.id))} vues • ${timeAgo(v.createdAt)}`;

  try{
    const vis = (v.visibilite||"publique");
    const link = tpl.querySelector('.thumb-link');
    if(link && (vis==="privé" || vis==="protégé")){
      var flag = document.createElement('div');
      flag.className = 'visibility-flag ' + (vis==="privé" ? 'prive' : 'protege');
      flag.textContent = vis;
      link.appendChild(flag);
    }
  }catch(e){}  const desc = (v.description || '').toString().trim();
  if(desc) tpl.querySelector('.desc').textContent = desc;
  const tagsWrap = tpl.querySelector('.tags');
  (v.tags||[]).slice(0,6).forEach(t=>{
    const badge=document.createElement('span'); badge.className='chip'; badge.textContent = t;
    tagsWrap.appendChild(badge);
  });
  const root = tpl.firstElementChild; 
  try{
    if(State.isSponsored && State.isSponsored(v.id)){
      var rootEl = tpl.firstElementChild; if(rootEl) rootEl.classList.add('sponsored');
      var lnk = tpl.querySelector('.thumb-link'); if(lnk){ lnk.style.position='relative'; var flag=document.createElement('div'); flag.className='sponso-flag'; flag.textContent='sponsorisé'; lnk.appendChild(flag); }
    }
  }catch(e){}
  makeClickable(root, `#/video/${v.id}`); return tpl;
}
function videoCard(v){
  const tpl=$("#videoCardTemplate").content.cloneNode(true);
  const a=tpl.querySelector('.thumb-link'); a.href=`#/video/${v.id}`;
  tpl.querySelector('.thumb').src=v.thumb; tpl.querySelector('.thumb').alt=v.title;
  const ch = getUser(v.channelId);
  tpl.querySelector('.avatar').src = avatarSrcOrInitial(ch);
  tpl.querySelector('.title').textContent=v.title; tpl.querySelector('.title').href=`#/video/${v.id}`;
  tpl.querySelector('.chan').textContent=ch?.pseudo||'Utilisateur'; tpl.querySelector('.chan').href=`#/channel/${ch?.id}`; if(location.hash.startsWith('#/channel/')) tpl.querySelector('.chan').style.display='none';
  tpl.querySelector('.stats').textContent = `${formatNumber(State.views(v.id))} vues • ${timeAgo(v.createdAt)}`;
  // Make the entire card clickable (except when clicking on links inside)
  var root = tpl.firstElementChild;
  if(root){
    root.addEventListener('click', function(e){
      var anchor = e.target.closest('a');
      if(anchor) return; // let native anchor clicks work
      location.hash = `#/video/${v.id}`;
    });
  }
  try{
    if(State.isSponsored && State.isSponsored(v.id)){
      var root = tpl.firstElementChild; if(root) root.classList.add('sponsored');
      var link = tpl.querySelector('.thumb-link'); if(link){ var flag=document.createElement('div'); flag.className='sponso-flag'; flag.textContent='sponsorisé'; link.appendChild(flag); }
    }
  }catch(e){}
  try{
    const vis = (v.visibilite||"publique");
    const link = tpl.querySelector('.thumb-link');
    if(link && (vis==="privé" || vis==="protégé")){
      var flag = document.createElement('div');
      flag.className = 'visibility-flag ' + (vis==="privé" ? 'prive' : 'protege');
      flag.textContent = vis;
      link.appendChild(flag);
    }
  }catch(e){}
  return tpl;
}
function viewHome(){ const vids = DB.read('videos',[]).slice().sort((a,b)=> (State.isSponsored(b.id)-State.isSponsored(a.id)) || (b.createdAt-a.createdAt)); videoGrid(vids, "Dernières vidéos", { limit: 30 }) }
function computeTrendScore(v){
  try{
    const likes = (State.likeStats && State.likeStats(v.id) ? State.likeStats(v.id).likes : 0) || 0;
    const views = (State.views ? State.views(v.id) : 0) || 0;
    const commentsCount = ((State.comments && State.comments()) ? State.comments().filter(c => c.videoId === v.id).length : 0) || 0;
    const ch = (typeof getUser === 'function') ? getUser(v.channelId) : null;
    const isCertifiedOrAdmin = !!(ch && (ch.isAdmin || ch.verified || ch.isVerified));
    const multiplier = isCertifiedOrAdmin ? 1.3 : 1.0;
    const days = Math.max( (Date.now() - (v.createdAt || Date.now())) / (1000*60*60*24), 1 );
    const denom = days / 4.0;
    const base = (likes + views + commentsCount) * multiplier;
    return denom > 0 ? (base / denom) : base;
  }catch(e){
    console.warn("computeTrendScore error", e);
    return 0;
  }
}

function computePodiumScore(v){
  try{
    const stats = (State.likeStats && State.likeStats(v.id)) || {likes:0, dislikes:0};
    const likes = stats.likes || 0;
    const dislikes = stats.dislikes || 0;
    const views = (State.views ? State.views(v.id) : 0) || 0;
    const commentsCount = ((State.comments && State.comments()) ? State.comments().filter(c => c.videoId === v.id).length : 0) || 0;
    return likes + dislikes + views + commentsCount;
  }catch(e){
    console.warn("computePodiumScore error", e);
    return 0;
  }
}

function viewPodium(){ const vids = DB.read('videos',[]).slice().sort((a,b)=> (computePodiumScore(b) - computePodiumScore(a))); videoGrid(vids, "Podium", { prioritizeSponsored: false, limit: 10 }); }

function viewTrending(){
  const vids = DB.read('videos',[]).slice().sort((a,b)=> (State.isSponsored(b.id)-State.isSponsored(a.id)) || (computeTrendScore(b) - computeTrendScore(a)));
  videoGrid(vids, "Tendances", { limit: 15 });
}
function viewSubs(){ const me=State.me; if(!me){ $app().innerHTML = `
  <div class="video-layout">
    <div>
      <div class="player" id="player"></div>
      <div class="title-xl">${escapeHtml(v.title)}</div>

      <div class="video-header">
        <div class="vh-left">
          <img src="${avatarSrcOrInitial(ch)}" alt="pfp">
          <div class="vh-texts">
            <a class="vh-name" href="#/channel/${ch?.id}">${ch?.pseudo || 'Utilisateur'}</a>
            <div class="vh-subs">${formatNumber(State.subCount(ch?.id))} abonnés</div>
          </div>
          <div class="badge" id="subBtn">${State.me ? (State.isSubbed(ch.id, State.me.id) ? "Se désabonner" : "S'abonner") : "S'abonner"}</div>
        </div>
        <div class="vh-right">
          <div class="inline-actions">${(State.me && State.me.isAdmin) ? ('<div class="badge block-btn" id="blockBtn">'+(((typeof v!=='undefined')&&v&&v.blocked)?'débloquer':'bloquer')+'</div><div class="badge sponso-btn" id="sponsoBtn">sponso</div>') : ''}
            <div class="badge" id="likeBtn"><span class="material-symbols-rounded">thumb_up</span> J'aime (<span id="likeCount">0</span>)</div>
            <div class="badge" id="dislikeBtn"><span class="material-symbols-rounded">thumb_down</span> Je déteste (<span id="dislikeCount">0</span>)</div>
            <div class="badge" id="shareBtn"><span class="material-symbols-rounded">cast</span> Diffuser</div>
          </div>
        </div>
      </div>
    </div>
    <div class="rightbox">
      <div class="tabs">
        <button id="tabDesc" class="active">Description</button>
        <button id="tabCom">Commentaires</button>
      </div>
      <div class="tabcontent" id="tabContent"></div>
    </div>
  </div>`; return } const subIds=DB.read('subs',{})[me.id]||[]; const vids=DB.read('videos',[]).filter(v=>subIds.includes(v.channelId)).sort((a,b)=>b.createdAt-a.createdAt); videoGrid(vids, "Abonnements", { limit: 60 }) }
function viewCategory(cat){ const vids=DB.read('videos',[]).filter(v=>v.category===cat).sort((a,b)=> (State.isSponsored(b.id)-State.isSponsored(a.id)) || (b.createdAt-a.createdAt)); videoGrid(vids, cat, { limit: 60 }) }



function viewSearch(q){
  const app = $app(); app.innerHTML = "";
  const needle = (q||"").toLowerCase().trim();

  // Comptes (chaînes)
  const users = DB.read('users',[]).filter(u => {
    const s = [u.pseudo, u.nom, u.prenom].filter(Boolean).join(" ").toLowerCase();
    return s.includes(needle);
  });
  if(users.length){
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="section-title">Comptes</div>`;
    const list = document.createElement('div'); list.className = "channel-list";
    users.forEach(u => list.appendChild(channelRow(u)));
    sec.appendChild(list);
    app.appendChild(sec);
  }

  // Vidéos (liste verticale)
  let vids = DB.read('videos',[]).filter(v => {
    const t = (v.title||"").toLowerCase();
    const tags = (v.tags||[]).join(" ").toLowerCase();
    return t.includes(needle) || tags.includes(needle);
  });
  // Exclude private & protected videos from search
  vids = vids.filter(v => (v.visibilite||"publique") === "publique");

  vids = vids.sort((a,b)=> (State.isSponsored(b.id)-State.isSponsored(a.id)) || (b.createdAt-a.createdAt));
  const sec2 = document.createElement('div');
  const head = document.createElement('div'); head.className='section-title'; head.textContent='Vidéos';
  const list = document.createElement('div'); list.className='result-list';
  vids.forEach(v => list.appendChild(videoRow(v)));
  sec2.appendChild(head); sec2.appendChild(list); app.appendChild(sec2);
  if(!vids.length){ list.outerHTML = `<div class="feed-empty">Rien à afficher.</div>`; }
}

function __orig_viewVideo(id){
  const v = DB.read('videos',[]).find(x=>x.id===id); if(!v){ $app().innerHTML=`<div class="feed-empty">Vidéo introuvable.</div>`; return }
  const ch = getUser(v.channelId);
  $app().innerHTML = `
  <div class="video-layout">
    <div>
      <div class="player" id="player"></div>
      <div class="title-xl">${escapeHtml(v.title)}</div>
      
<div class="video-header">
  <div class="vh-left">
    <div class="vh-avatar"></div>
    <div class="vh-texts">
      <a class="vh-name" href="#/channel/${ch?.id}">${ch?.pseudo || 'Utilisateur'}</a>
      <div class="vh-subs">${formatNumber(State.subCount(ch?.id))} abonnés</div>
    </div>
    <div class="badge" id="subBtn"><span class="material-symbols-rounded">${State.me && State.isSubbed(ch.id, State.me.id) ? "person_remove" : "person_add"}</span> ${State.me ? (State.isSubbed(ch.id, State.me.id) ? "Se désabonner" : "S'abonner") : "S'abonner"}</div>
  </div>
  <div class="vh-right">
    <div class="inline-actions">${(State.me && State.me.isAdmin) ? ('<div class="badge block-btn" id="blockBtn">'+(((typeof v!=='undefined')&&v&&v.blocked)?'débloquer':'bloquer')+'</div><div class="badge sponso-btn" id="sponsoBtn">sponso</div>') : ''}
      <div class="badge" id="likeBtn"><span class="material-symbols-rounded">thumb_up</span> J'aime (<span id="likeCount">0</span>)</div>
      <div class="badge" id="dislikeBtn"><span class="material-symbols-rounded">thumb_down</span> Je déteste (<span id="dislikeCount">0</span>)</div>
      <div class="badge" id="shareBtn"><span class="material-symbols-rounded">cast</span> Diffuser</div>
</div>
  </div>
</div>
  </div>
<div class="rightbox">
  <div class="tabs">
    <button id="tabDesc" class="active">Description</button>
    <button id="tabCom">Commentaires</button>
  </div>
  <div class="tabcontent" id="tabContent"></div>
</div>

</div>
</div>

</div>
  </div>`;
  const player=$("#player"); const yt=getYouTubeId(v.url);
  player.innerHTML = yt?`<iframe src="https://www.youtube.com/embed/${yt}" frameborder="0" allowfullscreen allow="accelerometer;
  autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`:`<video controls src="${v.url}" poster="${v.thumb}"></video>`;
  // 10s dwell-based view counting (silent, no rerender)
  try{
    const _tid = setTimeout(async ()=>{
      try{ await State.addView(v.id); }catch(e){}
      // Do NOT re-render here; counts will show on next page load
    }, 10000);
    const _clear = ()=>{ try{ clearTimeout(_tid); }catch(e){} window.removeEventListener('hashchange', _clear); };
    window.addEventListener('hashchange', _clear, { once:true });
  }catch(e){}

  const stats = State.likeStats(v.id); $("#likeCount").textContent=stats.likes;
  if(document.getElementById('dislikeCount')) document.getElementById('dislikeCount').textContent = stats.dislikes;
  // sponso: admin-only handler
// block/unblock: admin-only handler
try{
  var bb = document.getElementById('blockBtn');
  if(bb && State.me && State.me.isAdmin){
    bb.onclick = async function(){
      try{
        const vids = DB.read('videos',[]) || [];
        const idx = vids.findIndex(x=>x.id===id);
        if(idx >= 0){
          const cur = vids[idx] || {};
          const newBlocked = !Boolean(cur.blocked);
          vids[idx] = Object.assign({}, cur, { blocked: newBlocked });
          await API.set('videos', vids);
          DB.cache.videos = vids;
          // Update label immediately
          bb.textContent = newBlocked ? 'débloquer' : 'bloquer';
          // Update player UI
          const player = document.getElementById('player');
          if(newBlocked){
            // prevent preroll and show blocked image
            window.__noPreRoll = true;
            if(player){
              player.innerHTML = '<img src="bloque.svg" alt="Vidéo bloquée" style="width:100%;height:100%;object-fit:contain">';
            }
          }else{
            // reload current view
            try{ if(typeof route==='function'){ route(); } else { location.hash = location.hash; } }catch(e){ location.hash = location.hash; }
          }
        }
      }catch(e){ console.warn('block toggle failed', e); }
    };
  }
}catch(e){}

  try{
    var sb = document.getElementById('sponsoBtn');
    if(sb && State.me && State.me.isAdmin){
      sb.onclick = async function(){
        // Build modal
        const dlg = document.createElement('dialog');
        dlg.className = 'modal';
        dlg.innerHTML = `
          <header><strong>Sponsoriser la vidéo</strong><button class="icon-button" id="closeSponso"><span class="material-symbols-rounded">close</span></button></header>
          <div class="body">
            <label>Fin de sponsorisation
              <input type="date" id="sponsoDate">
            </label>
            <div class="actions">
              <button class="btn" id="sponsoRemove">Retirer</button>
              <div class="spacer"></div>
              <button class="btn primary" id="sponsoSave">Valider</button>
            </div>
            <div id="sponsoNote" class="statline"></div>
          </div>`;
        document.body.appendChild(dlg);
        dlg.showModal();
        const _close = ()=>{ try{dlg.close(); dlg.remove();}catch(e){} };
        dlg.querySelector('#closeSponso').onclick = _close;
        const currentUntil = (DB.read('sponso',{})||{})[v.id] || 0;
        if(currentUntil && currentUntil > Date.now()){
          dlg.querySelector('#sponsoNote').textContent = 'Actuellement sponsorisé jusqu\'au ' + (new Date(currentUntil)).toLocaleDateString();
        } else {
          dlg.querySelector('#sponsoRemove').style.display = 'none';
        }
        dlg.querySelector('#sponsoSave').onclick = async ()=>{
          const inp = dlg.querySelector('#sponsoDate');
          const dateStr = (inp && inp.value) || '';
          if(!dateStr){ uiAlert('Choisissez une date.'); return; }
          const untilTs = new Date(dateStr + 'T23:59:59').getTime();
          await State.setSponso(v.id, untilTs);
          _close();
          location.reload();
        };
        dlg.querySelector('#sponsoRemove').onclick = async ()=>{
          await State.setSponso(v.id, 0);
          _close();
          location.reload();
        };
      };
    }
  }catch(e){}

  const vhAv = $(".vh-avatar"); if(vhAv){ vhAv.replaceWith(makeAvatarElement(ch, 40)); }
  const vhimg = document.querySelector('.video-header .vh-left img'); if(vhimg) vhimg.src = avatarSrcOrInitial(ch);
  $("#likeBtn").onclick = async ()=>{ if(!State.me) return openAuthModal('login'); await State.toggleLike(v.id, State.me.id); // Update UI in place (no reload)
    (function(){ const el = document.getElementById('likeBtn'); if(el){ el.classList.remove('pulse-like'); void el.offsetWidth; el.classList.add('pulse-like'); } })();
(function(){ 
  try{
    const vid = id || (location.hash.match(/^#\/video\/(.+)/)||[])[1];
    const stats = State.likeStats(vid || id);
    const likesMap = DB.read('likes', {}) || {};
    const L = likesMap[vid || id] || {likes:[], dislikes:[]};
    const uid = State.me && State.me.id;
    const likeEl = document.getElementById('likeBtn');
    const dislikeEl = document.getElementById('dislikeBtn');
    const subEl = document.getElementById('subBtn');
    var lk = document.getElementById('likeCount');
    if(lk) lk.textContent = stats.likes;
    var dk = document.getElementById('dislikeCount');
    if(dk) dk.textContent = stats.dislikes;
    if(likeEl) likeEl.classList.toggle('like-active', !!(uid && Array.isArray(L.likes) && L.likes.includes(uid)));
    if(dislikeEl) dislikeEl.classList.toggle('dislike-active', !!(uid && Array.isArray(L.dislikes) && L.dislikes.includes(uid)));
    // Update sub button + count if applicable
    try{
      const v = (DB.read('videos',[])||[]).find(x=>x.id===(vid||id));
      const chId = v && v.channelId;
      if(chId && subEl){
        const isSub = State.me && State.isSubbed(chId, State.me.id);
        subEl.classList.toggle('sub-join', !isSub);
        subEl.classList.toggle('sub-leave', !!isSub);
        (function(){
      updateSubBtnUI(subEl, isSub);
      /* preserve icon & structure */
    })();
        const subsEl = document.querySelector('.vh-subs');
        if(subsEl) subsEl.textContent = (State.subCount(chId)).toLocaleString('fr-FR') + ' abonnés';
      }
    }catch(e){}
  }catch(e){}
})(); 
// trigger pulse-like halo animation
(function(btn){
  try {
    if(!btn) return;
    btn.classList.remove('pulse-like');
    void btn.offsetWidth; // restart animation
    btn.classList.add('pulse-like');
    btn.addEventListener('animationend', function handler() {
      btn.classList.remove('pulse-like');
      btn.removeEventListener('animationend', handler);
    });
  } catch(e){}
})(document.getElementById('likeBtn'));
}
  $("#dislikeBtn").onclick = async ()=>{ if(!State.me) return openAuthModal('login'); await State.toggleDislike(v.id, State.me.id); // Update UI in place (no reload)
    (function(){ const el = document.getElementById('dislikeBtn'); if(el){ el.classList.remove('pulse-dislike'); void el.offsetWidth; el.classList.add('pulse-dislike'); } })();
(function(){ 
  try{
    const vid = id || (location.hash.match(/^#\/video\/(.+)/)||[])[1];
    const stats = State.likeStats(vid || id);
    const likesMap = DB.read('likes', {}) || {};
    const L = likesMap[vid || id] || {likes:[], dislikes:[]};
    const uid = State.me && State.me.id;
    const likeEl = document.getElementById('likeBtn');
    const dislikeEl = document.getElementById('dislikeBtn');
    const subEl = document.getElementById('subBtn');
    var lk = document.getElementById('likeCount');
    if(lk) lk.textContent = stats.likes;
    var dk = document.getElementById('dislikeCount');
    if(dk) dk.textContent = stats.dislikes;
    if(likeEl) likeEl.classList.toggle('like-active', !!(uid && Array.isArray(L.likes) && L.likes.includes(uid)));
    if(dislikeEl) dislikeEl.classList.toggle('dislike-active', !!(uid && Array.isArray(L.dislikes) && L.dislikes.includes(uid)));
    // Update sub button + count if applicable
    try{
      const v = (DB.read('videos',[])||[]).find(x=>x.id===(vid||id));
      const chId = v && v.channelId;
      if(chId && subEl){
        const isSub = State.me && State.isSubbed(chId, State.me.id);
        subEl.classList.toggle('sub-join', !isSub);
        subEl.classList.toggle('sub-leave', !!isSub);
        (function(){
      updateSubBtnUI(subEl, isSub);
      /* preserve icon & structure */
    })();
        const subsEl = document.querySelector('.vh-subs');
        if(subsEl) subsEl.textContent = (State.subCount(chId)).toLocaleString('fr-FR') + ' abonnés';
      }
    }catch(e){}
  }catch(e){}
})(); 
// trigger pulse-dislike halo animation
(function(btn){
  try {
    if(!btn) return;
    btn.classList.remove('pulse-dislike');
    void btn.offsetWidth; // restart animation
    btn.classList.add('pulse-dislike');
    btn.addEventListener('animationend', function handler() {
      btn.classList.remove('pulse-dislike');
      btn.removeEventListener('animationend', handler);
    });
  } catch(e){}
})(document.getElementById('dislikeBtn'));
}
  $("#shareBtn").onclick = async ()=>{ await navigator.clipboard.writeText(v.url); uiAlert("URL de la vidéo copiée"); }
  $("#subBtn").onclick = async ()=>{ if(!State.me) return openAuthModal('login'); await State.toggleSub(ch.id, State.me.id);
(function(){
          try{
            const subEl = document.getElementById('subBtn');
            // Determine channel id based on current view
            var chId = null;
            try{
              const vid = (location.hash.match(/^#\/video\/(.+)/)||[])[1];
              if(vid){
                const v = (DB.read('videos',[])||[]).find(x=>x.id===vid);
                chId = v && v.channelId;
              }
            }catch(e){}
            if(!chId){
              // Channel page
              try{
                const path = (location.hash||'').match(/^#\/channel\/(.+)/);
                const idOrHandle = path && path[1];
                const u = getUser(idOrHandle);
                chId = u && u.id;
              }catch(e){}
            }
            if(subEl && chId){
              const isSub = State.me && State.isSubbed(chId, State.me.id);
              subEl.classList.add('clickable','sub-enhanced');
              subEl.classList.toggle('sub-join', !isSub);
              subEl.classList.toggle('sub-leave', !!isSub);
              (function(){
      updateSubBtnUI(subEl, isSub);
      /* preserve icon & structure */
    })();
              const subsEl = document.querySelector('.vh-subs');
              if(subsEl) subsEl.textContent = (State.subCount(chId)).toLocaleString('fr-FR') + ' abonnés';
            }
          }catch(e){}
        })(); }
const showDesc = ()=> {
    const tags = v.tags.map(t=>`<span class="chip">#${escapeHtml(t)}</span>`).join(' ');
    const meta = `<div class="desc-meta"><strong>${formatNumber(State.views(v.id))} vues</strong> • ${timeAgo(v.createdAt)} ${tags?`• ${tags}`:''}</div>`;
    $("#tabContent").innerHTML = `${meta}<p>${linkify(escapeHtml((v.desc||v.description||''))).replaceAll('\n','<br>')}</p>`;
  };
  const showCom = ()=> renderComments(v.id);
  $("#tabDesc").onclick=(e)=>{ $$(".tabs button").forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); showDesc(); };
  $("#tabCom").onclick=(e)=>{ $$(".tabs button").forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); showCom(); };
  showDesc();

  // Admin control: edit video
  try{
    if(State.me && State.me.isAdmin){
      var share = document.getElementById('shareBtn');
      var host = share ? share.parentElement : document.querySelector('.video-header') || document.querySelector('.title-xl')?.parentElement;
      if(host){
        var vbtn = document.createElement('button');
        vbtn.className = 'badge admin-edit';
        vbtn.textContent = 'modifier video';
        vbtn.style.marginLeft = '8px';
        vbtn.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation();
          openEditVideoModal(id);
        });
        host.appendChild(vbtn);
      }
    }
  }catch(e){}
}

function renderComments(videoId){
  const box=$("#tabContent"); const list=DB.read('comments',[]).filter(c=>c.videoId===videoId).sort((a,b)=>b.createdAt-a.createdAt);
  box.innerHTML = `${State.me?`
    <form id="commentForm" style="display:flex;gap:8px;margin-bottom:8px">
      <input name="text" placeholder="Ajouter un commentaire..." style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);background:#111;color:#fff">
      <button class="btn primary" type="submit">Envoyer</button>
    </form>`:`<div class="feed-empty">Connectez-vous pour commenter.</div>`}
    <div id="commentsList"></div>`;
  const listBox=$("#commentsList");
  if(list.length===0) listBox.innerHTML=`<div class="feed-empty">Aucun commentaire.</div>`;
  list.forEach(c=>{ const u=getUser(c.userId); const el=document.createElement('div'); el.style.padding='8px 0'; el.innerHTML=`<div class="channel-line"><img src="${u?.photo||'assets/placeholder.svg'}"><strong>${u?.pseudo||'Utilisateur'}</strong> <span class="statline"> • ${timeAgo(c.createdAt)}</span></div><div style="margin-left:46px">${escapeHtml(c.text)}</div>`; listBox.appendChild(el);
    try{
      const img = el.querySelector('img');
      if(img){ img.src = (u && u.photo) ? u.photo : avatarSrcOrInitial(u); img.onerror = ()=>{ img.src = avatarSrcOrInitial(u) } }
    }catch(_){}
  });
  const form=$("#commentForm"); if(form){ form.onsubmit = async (e)=>{ e.preventDefault(); const text=new FormData(form).get('text')?.toString().trim(); if(!text) return; await State.saveComment({id:uid(), videoId, userId:State.me.id, text, createdAt:Date.now()}); // notify owner
      const v=DB.read('videos',[]).find(v=>v.id===videoId); const notes = DB.read('notifications',{}); notes[v.channelId] ??= []; notes[v.channelId].push(`Nouveau commentaire sur "${v.title}" par ${State.me.pseudo}`); await DB.write('notifications', notes); renderComments(videoId); } }
}

function viewChannel(idOrHandle){
  // normalize channel description
  /* chDesc used for single render & dedupe */
  
  const u=getUser(idOrHandle); if(!u){ if(State.me){ return viewChannel(State.me.id); } $app().innerHTML="<div class='feed-empty'>Chaîne introuvable.</div>"; return }
  const name = (u.pseudo||'Chaîne');
  const rawHeader = (u.header||'').trim();
  const bg = _colorFromString(String(u?.id||u?.pseudo||'x'));
  const headerHtml = rawHeader
    ? `<div style="height:200px;background:url('${rawHeader}') center/cover no-repeat"></div>`
    : `<div style="height:200px;background:${bg};display:flex;align-items:center;justify-content:center"><div style="color:#fff;font-weight:800;font-size:32px">${escapeHtml(name)}</div></div>`;
  const chDesc = (u.desc||u.bio||u.description||'').trim();
  let vids =DB.read('videos',[]).filter(v=>v.channelId===u.id).sort((a,b)=>b.createdAt-a.createdAt);
  
  // Channel visibility: show private/protected only to subscribers
  try{
    const me = State.me;
    const subsMap = DB.read('subs',{}) || {};
    const mySubs = me ? (subsMap[me.id] || []) : [];
    const before = vids.length;
    vids = vids.filter(v => {
      const vis = (v.visibilite||"publique");
      if(vis === "publique") return true;
      return me && Array.isArray(mySubs) && mySubs.includes(v.channelId);
    });
  }catch(e){}$app().innerHTML = `
    <div class="card" style="overflow:hidden">
      ${headerHtml}
      <div style="display:flex;gap:12px;align-items:center;padding:12px">
        <img src="${u.photo || avatarSrcOrInitial(u)}" onerror="this.onerror=null;this.src=avatarSrcOrInitial(u)" style="width:80px;height:80px;border-radius:50%;object-fit:cover;background:#111">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="title-xl" style="margin:0;padding:0">${u.pseudo}</div>
          <div class="statline">• ${formatNumber(State.subCount(u.id))} abonnés • ${DB.read('videos',[]).filter(x=>x.channelId===u.id).length} vidéos</div>
          ${ chDesc ? `<div class="statline ch-desc">${escapeHtml(chDesc)}</div>` : '' }
        </div>
        <div style="margin-left:auto">${State.me && State.me.id!==u.id?`<div class="badge" id="subBtn">${State.isSubbed(u.id, State.me?.id)?"Se désabonner":"S'abonner"}</div>`:''}</div>
      </div>
    </div>
    <div class="section-title">Vidéos</div>
    <div class="grid" id="grid"></div>`;
  // Robust de-duplication of channel description statlines
  try{
    const descText = (typeof chDesc === 'string') ? chDesc.trim() : '';
    if(descText){
      let seen = false;
      $$('.statline').forEach(node=>{
        const t = (node.textContent||'').trim();
        // keep the first exact match, remove subsequent duplicates
        if(t === descText){
          if(seen){ node.remove(); } else { 
            seen = true; 
            node.classList.add('ch-desc');
          }
        }
      });
    }
  }catch(e){}

  try{ const descs = $$('.ch-desc'); if(descs.length>1){ for(let i=1;i<descs.length;i++){ descs[i].remove(); } } }catch(e){}

  const grid=$("#grid"); if(!vids.length) grid.outerHTML=`<div class="feed-empty">Aucune vidéo.</div>`; else vids.forEach(v=>grid.appendChild(videoCard(v)));
  const chAv = $(".channel-avatar"); if(chAv){ chAv.replaceWith(makeAvatarElement(u, 80)); }
  const subBtn=$("#subBtn"); if(subBtn){ subBtn.onclick=async ()=>{ if(!State.me) return openAuthModal("login"); await State.toggleSub(u.id, State.me.id);
        // Force full page reload on channel after subscribe toggle
        location.reload();
        (function(){
          try{
            const subEl = document.getElementById('subBtn');
            // Determine channel id based on current view
            var chId = null;
            try{
              const vid = (location.hash.match(/^#\/video\/(.+)/)||[])[1];
              if(vid){
                const v = (DB.read('videos',[])||[]).find(x=>x.id===vid);
                chId = v && v.channelId;
              }
            }catch(e){}
            if(!chId){
              // Channel page
              try{
                const path = (location.hash||'').match(/^#\/channel\/(.+)/);
                const idOrHandle = path && path[1];
                const u = getUser(idOrHandle);
                chId = u && u.id;
              }catch(e){}
            }
            if(subEl && chId){
              const isSub = State.me && State.isSubbed(chId, State.me.id);
              subEl.classList.add('clickable','sub-enhanced');
              subEl.classList.toggle('sub-join', !isSub);
              subEl.classList.toggle('sub-leave', !!isSub);
              (function(){
      updateSubBtnUI(subEl, isSub);
      /* preserve icon & structure */
    })();
              const subsEl = document.querySelector('.vh-subs');
              if(subsEl) subsEl.textContent = (State.subCount(chId)).toLocaleString('fr-FR') + ' abonnés';
            }
          }catch(e){}
        })(); } }

  // Admin control: edit channel
  try{
    if(State.me && State.me.isAdmin){
      var refBtn = document.querySelector('#subBtn');
      var host = refBtn ? refBtn.parentElement : document.querySelector('.card');
      if(host){
        var abtn = document.createElement('button');
        abtn.className = 'badge admin-edit';
        abtn.textContent = 'modifier chaine';
        abtn.style.marginLeft = '8px';
        abtn.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation();
          window.__adminEditTargetId = (u && u.id) || idOrHandle;
          openAdminEditUserDialog((u && u.id) || idOrHandle);
        });
        host.appendChild(abtn);
      }
    }
  }catch(e){}
}

function getUser(idOrHandle){ const users = DB.read('users',[]); return users.find(u => u.id===idOrHandle || u.handle===idOrHandle) || null }


/* === New Views === */
function viewMyVideos(){
  const root=$("#root"); const me=State.me; if(!me) return openAuthModal('login');
  const vids = DB.videos().filter(v=>v.authorId===me.id);
  root.innerHTML = `<div class="container">
    <div class="title-xl">Mes vidéos</div>\n          <div class="statline">${(u.desc||u.bio||u.description||'').trim() ? escapeHtml((u.desc||u.bio||u.description||'').trim()) : ''}</div>
    <div id="myvids"></div>
  </div>`;
  const wrap=$("#myvids");
  if(!vids.length){ wrap.innerHTML=`<div class="muted">Aucune vidéo publiée.</div>`; return; }
  vids.forEach(v=>{
    const row=document.createElement('div');
    row.className='card';
    row.style.margin='8px 0';
    row.innerHTML=`
      <div style="display:flex;gap:12px;align-items:center">
        <img src="${v.thumb||'assets/placeholder.svg'}" style="width:120px;height:68px;object-fit:cover;border-radius:8px">
        <div style="flex:1">
          <div class="title">${v.title}</div>
          <div class="muted">${(v.tags||[]).map(t=>'#'+t).join(' ')}</div>
        </div>
        <button class="btn" data-act="edit">Modifier</div>
      </div>
      <div class="muted" style="margin-top:8px">Likes: ${DB.likeStats(v.id).likes} — Dislikes: ${DB.likeStats(v.id).dislikes}</div>
    `;
    row.querySelector('[data-act="edit"]').onclick=()=>openEditVideo(v);
    wrap.appendChild(row);
  });
}


async function openEditVideo(v){
  const title = await uiPrompt("Nouveau titre", v.title||"", { title: "Modifier la vidéo" });
  if(title===null) return;
  const desc = await uiPrompt("Description", v.desc||"", { title: "Modifier la vidéo", multiline: true });
  if(desc===null) return;
  const thumb = await uiPrompt("URL miniature", v.thumb||"", { title: "Modifier la vidéo" });
  if(thumb===null) return;
  const tags = await uiPrompt("Tags (séparés par des virgules)", (v.tags||[]).join(','), { title: "Modifier la vidéo" });
  if(tags===null) return;
  v.title = title;
  v.desc = desc;
  v.thumb = thumb;
  v.tags = (tags||'').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  DB.saveVideo(v).then(()=>route());
}


function viewEditProfile(){
  const root=$("#root"); let me=State.me; const __t=(window.__adminEditTargetId && State.me && State.me.isAdmin)?getUser(window.__adminEditTargetId):null; if(__t) me=__t; if(!me) return openAuthModal('login');
  root.innerHTML = `<div class="container" style="max-width:800px">
    <div class="title-xl">Modifier le profil</div>
    <div class="card" style="padding:16px;display:grid;gap:10px">
      <label>Nom d'affichage <input id="in-name" value="${me.pseudo||me.nom||''}" /></label>
      <div class="pe-section-title">Sécurité &amp; Contact</div><label>Numéro de téléphone <input id="in-phone" value="${me.phone||''}" /></label>
      <label>Compte bancaire (IBAN) <input id="in-iban" value="${me.iban||''}" /></label>
      <label>URL photo de profil <input id="in-avatar" value="${me.photo||''}" /></label>
      <label>URL bannière (header) <input id="in-header" value="${me.header||''}" /></label>
      <div class="title" style="margin-top:6px">Utilisateurs invités</div>
      <div id="linked"></div>
      <div style="display:flex;gap:8px">
        <input id="in-link" placeholder="ID utilisateur à inviter">
        <button class="btn" id="btn-add">Inviter</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn primary" id="btn-save">Enregistrer</div>
      </div>
    </div>
  </div>`;
  const linked = me.linkedIds||[];
  const list = document.createElement('div');
  linked.forEach(id=>{
    const u=getUser(id);
    const item=document.createElement('div'); item.style.display='flex'; item.style.gap='8px'; item.style.alignItems='center'; item.style.margin='4px 0';
    item.innerHTML=`<span class="muted">${u?u.pseudo||u.nom:id}</span> <button class="btn" data-id="${id}">Retirer</div>`;
    list.appendChild(item);
  });
  $("#linked").appendChild(list);
  $("#btn-add").onclick=()=>{
    const id=$("#in-link").value.trim(); if(!id) return;
    me.linkedIds = Array.from(new Set([...(me.linkedIds||[]), id]));
    DB.saveUser(me).then(()=>viewEditProfile());
  };
  list.addEventListener('click', (e)=>{
    if(e.target.matches('button[data-id]')){
      const id=e.target.getAttribute('data-id');
      me.linkedIds=(me.linkedIds||[]).filter(x=>x!==id);
      DB.saveUser(me).then(()=>viewEditProfile());
    }
  });
  $("#btn-save").onclick=()=>{
    me.pseudo=$("#in-name").value.trim();
    me.phone=$("#in-phone").value.trim();
    me.iban=$("#in-iban").value.trim();
    me.photo=$("#in-avatar").value.trim();
    me.header=$("#in-header").value.trim();
    DB.saveUser(me).then(()=>{ uiAlert("Profil mis à jour"); route(); });
  };
}

function viewAccountSwitcher(){
  const root=$("#root");
  const users = DB.users();
  const me = State.me;
  root.innerHTML = `<div class="container" style="max-width:760px">
    <div class="title-xl">Changer de compte</div>
    <div class="card" style="padding:16px">
      <div id="acc-list"></div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn" id="btn-login">Se connecter à un autre compte</div>
        <button class="btn" id="btn-create">Créer un compte</div>
      </div>
    </div>
  </div>`;
  const wrap=$("#acc-list");
  users.forEach(u=>{
    const row=document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.padding='8px 0'; row.style.borderBottom='1px solid var(--line)';
    row.innerHTML = `<div style="display:flex;gap:10px;align-items:center">
        <img src="${avatarSrcOrInitial(u)}" style="width:32px;height:32px;border-radius:50%">
        <div>${u.pseudo||u.nom} <span class="muted">(${u.id})</span></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${me && (me.linkedIds||[]).includes(u.id) ? '<span class="badge">Lié</span>' : ''}
        <button class="btn" data-act="switch" data-id="${u.id}">Basculer</div>
        ${me && u.id!==me.id ? `<button class="btn" data-act="link" data-id="${u.id}">Lier</div>` : ''}
      </div>`;
    wrap.appendChild(row);
  });
  wrap.addEventListener('click', (e)=>{
    const id=e.target.getAttribute && e.target.getAttribute('data-id');
    const act=e.target.getAttribute && e.target.getAttribute('data-act');
    if(!id || !act) return;
    if(act==='switch'){ State.me = getUser(id); renderTopbar(); route(); }
    if(act==='link' && me){ me.linkedIds = Array.from(new Set([...(me.linkedIds||[]), id])); DB.saveUser(me).then(()=>viewAccountSwitcher()); }
  });
  $("#btn-login").onclick=()=>openAuthModal('login');
  $("#btn-create").onclick=()=>openAuthModal('register');
}

/* Init */
renderTopbar();
DB.init().then(()=> { route(); try{ updateNotifBadge(); }catch(e){} });

/* === My Videos (Studio-like list & editor) === */
function viewMyVideos(){
  const me = State.me;
  const app = $app(); app.innerHTML="";
  if(!me){
    const div=document.createElement('div');
    div.className='section-title';
    div.textContent="Connectez-vous pour voir vos vidéos";
    app.append(div);
    return;
  }
  const title = document.createElement('div');
  title.className='section-title';
  title.textContent = "Mes vidéos";
  app.append(title);

  const table = document.createElement('div');
  table.className='video-table';
  const header = document.createElement('div');
  header.className='row header';
  header.innerHTML = `<div class="cell thumb">Miniature</div>
  <div class="cell title">Titre</div>
  <div class="cell date">Date</div>
  <div class="cell views">Vues</div>
  <div class="cell comments">Commentaires</div>
  <div class="cell likes">Likes/Dislikes</div>`;
  table.append(header);

  const myVids = State.videos().filter(v=>v.channelId===me.id).sort((a,b)=>b.createdAt-a.createdAt);
  if(myVids.length===0){
    const empty=document.createElement('div');
    empty.className='empty';
    empty.textContent="Aucune vidéo. Utilisez le bouton 'Poster' pour en publier une.";
    app.append(empty);
    return;
  }

  myVids.forEach(v=>{
    const views = State.views(v.id);
    const comm = State.comments().filter(c=>c.videoId===v.id).length;
    const like = State.likeStats(v.id);
    const ratio = (like.likes + like.dislikes) ? Math.round((like.likes/(like.likes+like.dislikes))*100) : 0;
    const row = document.createElement('div');
    row.className='row data';
    row.tabIndex=0;
    row.innerHTML = `
      <div class="cell thumb"><img src="${v.thumb||'assets/placeholder.svg'}" alt="" /></div>
      <div class="cell title"><div class="vtitle">${escapeHtml(v.title||'Sans titre')}</div></div>
      <div class="cell date">${formatDate(v.createdAt)}</div>
      <div class="cell views">${formatNumber(views)}</div>
      <div class="cell comments">${formatNumber(comm)}</div>
      <div class="cell likes">${like.likes}/${like.dislikes} (${ratio}%)</div>`;
    row.addEventListener('click', ()=> openEditVideoModal(v.id));
    row.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openEditVideoModal(v.id); } });
    table.append(row);
  });

  app.append(table);
}

function openEditVideoModal(id){
  const v = State.videos().find(x=>x.id===id);
  if(!v) return;
  const dlg = $("#postModal");
  dlg.innerHTML = `<header><strong>Modifier la vidéo</strong><div class="spacer"></div><button class="icon-button" onclick="this.closest('dialog').close()"><span class="material-symbols-rounded">close</span></button></header>
  <div class="body">
    <form id="editVideoForm" class="form-grid">
      <div class="thumb-edit"><img id="editThumbPreview" src="${v.thumb||'assets/placeholder.svg'}" alt=""></div>
      <label>Titre<input name="title" value="${escapeAttribute(v.title||'')}" required></label>
      <label>Miniature (URL) <input name="thumb" value="${escapeAttribute(v.thumb||'')}" placeholder="https://..."></label>
      
<label>Catégorie
  <select name="category">
    <option value="Video">Video</option>
    <option value="Short">Short</option>
    <option value="News">News</option>
    <option value="Fiction">Fiction</option>
    <option value="Musique">Musique</option>
  </select>
</label>
<label>Visibilité
  <select name="visibilite">
    <option value="publique">publique</option>
    <option value="privé">privé</option>
    <option value="protégé">protégé</option>
  </select>
</label>
<label>Date de publication
  <input type="datetime-local" name="createdAt" value="${formatDateTimeLocal(v.createdAt)}">
</label>
<label class="visi-pass-wrap"><span class="pm-label small">Mot de passe</span>
  <input name="visipass" type="text" placeholder="Mot de passe (requis pour 'protégé')">
</label>
<label>Tags (séparés par des virgules)<input name="tags" value="${escapeAttribute(Array.isArray(v.tags)?v.tags.join(', '):(v.tags||''))}"></label>
      <label>Description<textarea name="desc">${escapeTextarea(v.desc||'')}</textarea></label>
      <div class="actions">
        <button type="button" class="btn danger" id="deleteVideoBtn"><span class="material-symbols-rounded">delete</span> Supprimer</button>
        <div class="spacer"></div>
        <button type="submit" class="btn primary"><span class="material-symbols-rounded">save</span> Enregistrer</button>
      </div>
    </form>
  </div>`;
  dlg.showModal();
  const form = $("#editVideoForm", dlg);
  if(form.category){ form.category.value = (v.category||"Video"); }
  
  if(form.visibilite){ form.visibilite.value = (v.visibilite||"publique"); }
  if(form.visipass){ form.visipass.value = (v.visipass||""); }
  try{
    const wrap = dlg.querySelector(".visi-pass-wrap");
    const sel = form.visibilite;
    const toggle = ()=>{ if(wrap) wrap.style.display = (sel && sel.value==="protégé") ? "" : "none"; };
    if(sel){ sel.addEventListener('change', toggle); toggle(); }
  }catch(e){}const preview = $("#editThumbPreview", dlg);
  form.thumb.addEventListener('input', ()=>{ preview.src = form.thumb.value || 'assets/placeholder.svg'; });
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const tags = (fd.tags||'').split(',').map(s=>s.trim()).filter(Boolean);
    const updated = Object.assign({}, v, {title: fd.title?.trim()||'Sans titre', thumb: (fd.thumb||'').trim(), tags, desc: fd.desc?.trim(), description: fd.desc?.trim(), category: fd.category, visibilite: fd.visibilite, visipass: (fd.visibilite==="protégé" ? (fd.visipass||"") : "")});
        let createdAt = v.createdAt || Date.now();
    if (fd.createdAt) {
      const dt = new Date(fd.createdAt);
      if (!Number.isNaN(dt.getTime())) {
        createdAt = dt.getTime();
      }
    }
    updated.createdAt = createdAt;
    await State.saveVideo(updated);
    dlg.close();
    viewMyVideos();
  };
  $("#deleteVideoBtn", dlg).onclick = async ()=>{
    if(!await uiConfirm("Supprimer définitivement cette vidéo ?")) return;
    const list = State.videos().filter(x=>x.id!==v.id);
    await DB.write('videos', list);
    dlg.close();
    viewMyVideos();
  };
}

// Small helpers for escaping HTML in form values
function escapeHtml(s){ return (s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function escapeAttribute(s){ return escapeHtml(String(s)).replace(/"/g,'&quot;'); }
function escapeTextarea(s){ return escapeHtml(String(s)); }
function formatDate(ts){ try{ const d=new Date(ts); return d.toLocaleDateString(); }catch(e){ return '' } }


function formatDateTimeLocal(ts){
  try{
    const d = ts ? new Date(ts) : new Date();
    const pad = (n)=> String(n).padStart(2,'0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }catch(e){
    return '';
  }
}
/* === Profile Edit page === */
function viewEditProfile(){
  const me = State.me;
  const app = $app(); app.innerHTML="";
  if(!me){ const d=document.createElement('div'); d.className='section-title'; d.textContent="Connectez-vous pour modifier votre profil"; app.append(d); return; }

  const h=document.createElement('div'); h.className='section-title'; h.textContent="Modifier le profil"; app.append(h);

  const wrap=document.createElement('div'); wrap.className='profile-edit';
  wrap.innerHTML = `
    <div class="preview-col">
      <div class="label">Photo de profil</div>
      <img id="pe-avatar" class="pe-avatar" src="${avatarSrcOrInitial(me)}" alt="">
      <div class="label">Header</div>
      <img id="pe-header" class="pe-header" src="${me.header||'assets/placeholder.svg'}" alt="">
    </div>
    <form id="pe-form" class="form-col"><div class="pe-section-title">Photo</div>
      <label>Lien photo de profil<input name="photo" value="${escapeAttribute(me.photo||'')}" placeholder="https://..."></label>
      <label>Lien header<input name="header" value="${escapeAttribute(me.header||'')}" placeholder="https://..."></label>
      <div class="pe-section-title">Identité</div><div class="grid2">
        <label>Prénom<input name="prenom" value="${escapeAttribute(me.prenom||'')}"></label>
        <label>Nom<input name="nom" value="${escapeAttribute(me.nom||'')}"></label>
      </div>
      <div class="pe-section-title">Chaîne</div><label>Pseudo<input name="pseudo" value="${escapeAttribute(me.pseudo||'')}" required></label>
      <label>Description<textarea name="desc">${escapeTextarea(me.desc||'')}</textarea></label>
      <label>Identifiant de chaîne (après /channel/)<input name="handle" value="${escapeAttribute(me.handle||'')}" placeholder="ex: MrYaroph"></label>
      <div class="pe-section-title">Sécurité &amp; Contact</div><label>Numéro de téléphone<input name="tel" value="${escapeAttribute(me.tel||'')}" ></label>
      <label>Numéro de compte<input name="iban" value="${escapeAttribute(me.iban||'')}" ></label>
      <label>Mot de passe<input name="password" type="${isAdminUser(State.me)?'text':'password'}" value="${escapeAttribute(me.password||'')}" ></label>
      <div class="actions">
        <button type="button" class="btn danger" id="pe-delete"><span class="material-symbols-rounded">delete</span> Supprimer la chaîne</button>
        <div class="spacer"></div>
        <button type="submit" class="btn primary"><span class="material-symbols-rounded">save</span> Enregistrer</button>
      </div>
    </form>`;

  app.append(wrap);

  const form = $("#pe-form", wrap);
  const av = $("#pe-avatar", wrap);
  const hd = $("#pe-header", wrap);

  form.photo.addEventListener('input', ()=>{ const u=form.photo.value.trim(); av.src = u || avatarSrcOrInitial(me); });
  form.header.addEventListener('input', ()=>{ const u=form.header.value.trim(); hd.src = u || 'assets/placeholder.svg'; });

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const updated = Object.assign({}, me, {
      photo: (fd.photo||'').trim(),
      header: (fd.header||'').trim(),
      prenom: (fd.prenom||'').trim(),
      nom: (fd.nom||'').trim(),
      pseudo: (fd.pseudo||'').trim(),
      desc: fd.desc||'',
      handle: (fd.handle||'').trim(),
      tel: (fd.tel||'').trim(),
      iban: (fd.iban||'').trim(),
      password: (fd.password||'')
    });
    await State.saveUser(updated);
    State.me = updated;
    renderTopbar();
    uiAlert("Profil mis à jour.");
    
    try {
      const map = DB.read('handles', {}) || {};
      const oldHandle = (me.handle||'').trim();
      const newHandle = (updated.handle||'').trim();
      if (oldHandle) map[oldHandle.toLowerCase()] = updated.id;
      if (newHandle) map[newHandle.toLowerCase()] = updated.id;
      await DB.write('handles', map);
    } catch(e) { console.warn('handle map update failed', e); }
navigate(`#/channel/${updated.handle||updated.id}`);
  };

  $("#pe-delete", wrap).onclick = async ()=>{
    if(!await uiConfirm("Supprimer définitivement votre chaîne ? Toutes vos vidéos, commentaires et likes seront supprimés.")) return;
    const meId = me.id;
    // remove user
    const users = State.users().filter(u=>u.id!==meId);
    await DB.write('users', users);
    // remove videos and related data
    const vids = State.videos().filter(v=>v.channelId!==meId);
    await DB.write('videos', vids);
    const comments = State.comments().filter(c=>c.userId!==meId && vids.some(v=>v.id===c.videoId));
    await DB.write('comments', comments);
    const likes = DB.read('likes',{});
    Object.keys(likes).forEach(vid=>{
      likes[vid].likes = (likes[vid].likes||[]).filter(x=>x!==meId);
      likes[vid].dislikes = (likes[vid].dislikes||[]).filter(x=>x!==meId);
    });
    await DB.write('likes', likes);
    // logout
    State.me = null; renderTopbar(); route();
    uiAlert("Chaîne supprimée.");
  };
}


// --- startup: ensure DB is loaded and session persists across reloads ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await DB.init();
  } catch (e) {
    console.error('Failed to init DB', e);
  }
  // If a prior session_user exists but the user isn't in cache yet,
  // re-fetch store as a safeguard (defensive).
  const sid = localStorage.getItem('session_user');
  if (sid) {
    const userInCache = (DB.read && DB.read('users', []) || []).find(u => u.id === sid);
    if (!userInCache && API && API.getStore) {
      try { await DB.init(); } catch(e){}
    }
  }
  renderTopbar();
  route();
});



/* --- Admin enhancement: comment deletion --- */
try{
  const __origRenderComments = renderComments;
  renderComments = function(videoId){
    __origRenderComments(videoId);
    try{
      if(State.me && State.me.isAdmin){
        const list = (DB.read('comments',[]) || []).filter(c=>c.videoId===videoId).sort((a,b)=>b.createdAt-a.createdAt);
        const box = document.getElementById('commentsList');
        if(!box) return;
        const nodes = Array.from(box.children || []);
        nodes.forEach((el, idx)=>{
          const c = list[idx];
          if(!c) return;
          /* removed duplicate admin delete button */ return;
          const del = document.createElement('button');
          del.className = 'icon-button admin-del';
          del.title = 'Supprimer';
          del.innerHTML = '<span class="material-symbols-rounded">delete</span>';
          del.style.marginLeft = '6px';
          del.addEventListener('click', async function(e){
            e.stopPropagation();
            if(await uiConfirm('Supprimer ce commentaire ?')){
              const updated = (DB.read('comments',[]) || []).filter(x=>x.id !== c.id);
              DB.write('comments', updated).then(()=> renderComments(videoId));
            }
          });
          const meta = el.querySelector('.meta');
          (meta || el).appendChild(del);
        });
      }
    }catch(_){}
  }
}catch(e){}



/* === Admin: full account editor dialog (v3) === */
function openAdminEditUserDialog(targetId){
  try{
    if(!State.me || !(State.me.isAdmin || State.me.admin===true)){
      uiAlert("Accès refusé : administrateur requis."); return;
    }
    const users = DB.read('users',[]) || [];
    const u = users.find(x => x.id === targetId || x.handle === targetId);
    if(!u){ uiAlert("Utilisateur introuvable: " + targetId); return; }

    const avatarUrl = (u.photo || u.avatar || "");
    const headerUrl = (u.header || "");

    let accountType = u.accountType || (u.isAdmin ? "admin" : (u.verified || u.isVerified ? "certifie" : "normal"));

    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <header>
        <strong>Modifier le profil</strong>
        <button class="icon-button" id="xClose" type="button"><span class="material-symbols-rounded">close</span></button>
      </header>
      <div class="body">
        <form id="adminUserForm" class="profile-edit" onsubmit="return false;">
          <div class="form-col">
            <div class="pe-section-title">Identité</div>
            <label>Pseudo
              <input name="pseudo" value="${escapeHtml(String(u.pseudo||''))}">
            </label>
            <div class="grid2">
              <label>Prénom
                <input name="prenom" value="${escapeHtml(String(u.prenom||''))}">
              </label>
              <label>Nom
                <input name="nom" value="${escapeHtml(String(u.nom||''))}">
              </label>
            </div>

            <label>Identifiant de chaîne (après /channel/)
              <input name="handle" placeholder="ex: MrYaroph" value="${escapeHtml(String(u.handle||''))}">
            </label>

            <label>Description
              <textarea name="desc" placeholder="Présentation...">${escapeHtml(String(u.desc||u.description||u.bio||''))}</textarea>
            </label>

            <div class="pe-section-title">Sécurité &amp; Contact</div>
            <div class="grid2">
              <label>Téléphone
                <input name="tel" value="${escapeHtml(String(u.tel||u.phone||''))}">
              </label>
              <label>Mot de passe
                <input name="password" type="text" value="${escapeHtml(String(u.password||''))}">
              </label>
            </div>
            <label>Type de compte
              <select name="accountType">
                <option value="normal" ${accountType==='normal'?'selected':''}>normal</option>
                <option value="certifie" ${accountType==='certifie'?'selected':''}>certifié</option>
                <option value="admin" ${accountType==='admin'?'selected':''}>admin</option>
              </select>
            </label>

            <div class="actions" style="margin-top:6px">
              <button class="btn primary" id="btnSave" type="button">Enregistrer</button>
              <button class="btn" id="btnCancel" type="button">Annuler</button>
            </div>
          </div>

          <div class="preview-col">
            <div class="label">Photo de profil</div>
            <img class="pe-avatar" id="pePreviewAvatar" src="${avatarUrl ? escapeHtml(avatarUrl) : (avatarSrcOrInitial ? avatarSrcOrInitial(u) : 'assets/placeholder.svg')}" alt="avatar">
            <div class="label">Header</div>
            <img class="pe-header" id="pePreviewHeader" src="${headerUrl || 'assets/placeholder.svg'}" alt="header">
            <div class="pe-section-title">Photo</div>
            <label>Lien photo de profil
              <input name="photo" id="peInputAvatar" placeholder="https://..." value="${escapeHtml(String(avatarUrl||''))}">
            </label>
            <label>Lien header
              <input name="header" id="peInputHeader" placeholder="https://..." value="${escapeHtml(String(headerUrl||''))}">
            </label>
          </div>
        </form>
      </div>`;

    document.body.appendChild(dlg);

    const $q = (s)=>dlg.querySelector(s);
    const close = () => { try{ dlg.close(); }catch(_){ } dlg.remove(); };

    $q('#xClose').addEventListener('click', close);
    $q('#btnCancel').addEventListener('click', close);

    // Live previews
    const prevA = $q('#pePreviewAvatar');
    const prevH = $q('#pePreviewHeader');
    $q('#peInputAvatar').addEventListener('input', (e)=>{ prevA.src = e.target.value.trim() || (avatarSrcOrInitial ? avatarSrcOrInitial(u) : 'assets/placeholder.svg'); });
    $q('#peInputHeader').addEventListener('input', (e)=>{ prevH.src = e.target.value.trim() || 'assets/placeholder.svg'; });

    // Save (no form submit)
    $q('#btnSave').addEventListener('click', async (ev)=>{
      ev.preventDefault();
      const form = $q('#adminUserForm');
      const fd = new FormData(form);
      const updated = { ...u };

      const simple = ["pseudo","prenom","nom","password","handle"];
      simple.forEach(k => { if(fd.has(k)) updated[k] = String(fd.get(k)||""); });

      updated.desc = String(fd.get("desc")||"");
      updated.tel = String(fd.get("tel")||"");
      if(!updated.phone) updated.phone = updated.tel;

      updated.photo = String(fd.get("photo")||"").trim();
      if(!updated.photo) delete updated.photo;
      updated.header = String(fd.get("header")||"").trim();
      if(!updated.header) delete updated.header;

      const at = String(fd.get("accountType")||"normal");
      updated.accountType = at;
      if(at === "admin"){
        updated.isAdmin = true;
        updated.verified = false;
      }else if(at === "certifie"){
        updated.isAdmin = false;
        updated.verified = true;
      }else{
        updated.isAdmin = false;
        updated.verified = false;
      }

      await DB.saveUser(updated);
      if(State.me && State.me.id === updated.id){ State.me = updated; renderTopbar && renderTopbar(); }

      close();

      // Navigate to new handle if changed
      try{
        const after = updated.handle ? updated.handle : updated.id;
        if(location.hash.startsWith("#/channel/")){
          location.hash = "#/channel/" + encodeURIComponent(after);
        }
      }catch(_){}

      route && route();
      setTimeout(()=>decorateUserBadgesInDom(document), 0);
    });

    try{ dlg.showModal(); }catch(_){ dlg.setAttribute('open',''); }
  }catch(err){
    console.error('Admin edit dialog error', err);
    uiAlert('Erreur lors de l’ouverture du panneau administrateur.');
  }
}



/* === Admin: full account editor dialog (v4 - robust save wiring) === */
function openAdminEditUserDialog(targetId){
  try{
    if(!State.me || !(State.me.isAdmin || State.me.admin===true)){
      uiAlert("Accès refusé : administrateur requis."); return;
    }
    const users = DB.read('users',[]) || [];
    const u = users.find(x => x.id === targetId || x.handle === targetId);
    if(!u){ uiAlert("Utilisateur introuvable: " + targetId); return; }

    const avatarUrl = (u.photo || u.avatar || "");
    const headerUrl = (u.header || "");

    let accountType = u.accountType || (u.isAdmin ? "admin" : (u.verified || u.isVerified ? "certifie" : "normal"));

    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <header>
        <strong>Modifier le profil</strong>
        <button class="icon-button" id="xClose" type="button"><span class="material-symbols-rounded">close</span></button>
      </header>
      <div class="body">
        <form id="adminUserForm" class="profile-edit">
          <div class="form-col">
            <div class="pe-section-title">Identité</div>
            <label>Pseudo
              <input name="pseudo" value="${escapeHtml(String(u.pseudo||''))}">
            </label>
            <div class="grid2">
              <label>Prénom
                <input name="prenom" value="${escapeHtml(String(u.prenom||''))}">
              </label>
              <label>Nom
                <input name="nom" value="${escapeHtml(String(u.nom||''))}">
              </label>
            </div>

            <label>Identifiant de chaîne (après /channel/)
              <input name="handle" placeholder="ex: MrYaroph" value="${escapeHtml(String(u.handle||''))}">
            </label>

            <label>Description
              <textarea name="desc" placeholder="Présentation...">${escapeHtml(String(u.desc||u.description||u.bio||''))}</textarea>
            </label>

            <div class="pe-section-title">Sécurité &amp; Contact</div>
            <div class="grid2">
              <label>Téléphone
                <input name="tel" value="${escapeHtml(String(u.tel||u.phone||''))}">
              </label>
              <label>Mot de passe
                <input name="password" type="text" value="${escapeHtml(String(u.password||''))}">
              </label>
            </div>
            <label>Type de compte
              <select name="accountType">
                <option value="normal" ${accountType==='normal'?'selected':''}>normal</option>
                <option value="certifie" ${accountType==='certifie'?'selected':''}>certifié</option>
                <option value="admin" ${accountType==='admin'?'selected':''}>admin</option>
              </select>
            </label>

            <div class="actions" style="margin-top:6px">
              <button class="btn primary" id="btnSave" type="button">Enregistrer</button>
              <button class="btn" id="btnCancel" type="button">Annuler</button>
            </div>
          </div>

          <div class="preview-col">
            <div class="label">Photo de profil</div>
            <img class="pe-avatar" id="pePreviewAvatar" src="${avatarUrl ? escapeHtml(avatarUrl) : (avatarSrcOrInitial ? avatarSrcOrInitial(u) : 'assets/placeholder.svg')}" alt="avatar">
            <div class="label">Header</div>
            <img class="pe-header" id="pePreviewHeader" src="${headerUrl || 'assets/placeholder.svg'}" alt="header">
            <div class="pe-section-title">Photo</div>
            <label>Lien photo de profil
              <input name="photo" id="peInputAvatar" placeholder="https://..." value="${escapeHtml(String(avatarUrl||''))}">
            </label>
            <label>Lien header
              <input name="header" id="peInputHeader" placeholder="https://..." value="${escapeHtml(String(headerUrl||''))}">
            </label>
          </div>
        </form>
      </div>`;

    document.body.appendChild(dlg);

    const $q = (s)=>dlg.querySelector(s);
    const form = $q('#adminUserForm');
    const btnSave = $q('#btnSave');
    const btnCancel = $q('#btnCancel');
    const btnClose = $q('#xClose');

    const close = () => { try{ dlg.close(); }catch(_){ } dlg.remove(); };

    btnClose && btnClose.addEventListener('click', close);
    btnCancel && btnCancel.addEventListener('click', close);

    // Live previews
    const prevA = $q('#pePreviewAvatar');
    const prevH = $q('#pePreviewHeader');
    const inputAvatar = $q('#peInputAvatar');
    const inputHeader = $q('#peInputHeader');
    inputAvatar && inputAvatar.addEventListener('input', (e)=>{ prevA.src = e.target.value.trim() || (avatarSrcOrInitial ? avatarSrcOrInitial(u) : 'assets/placeholder.svg'); });
    inputHeader && inputHeader.addEventListener('input', (e)=>{ prevH.src = e.target.value.trim() || 'assets/placeholder.svg'; });

    async function handleSave(ev){
      try{
        ev && ev.preventDefault();
        if(!btnSave) return;
        btnSave.disabled = true;
        btnSave.textContent = "Enregistrement...";

        const fd = new FormData(form);
        const updated = { ...u };

        const simple = ["pseudo","prenom","nom","password","handle"];
        simple.forEach(k => { if(fd.has(k)) updated[k] = String(fd.get(k)||""); });

        updated.desc = String(fd.get("desc")||"");
        updated.tel = String(fd.get("tel")||"");
        if(!updated.phone) updated.phone = updated.tel;

        updated.photo = String(fd.get("photo")||"").trim();
        if(!updated.photo) delete updated.photo;
        updated.header = String(fd.get("header")||"").trim();
        if(!updated.header) delete updated.header;

        const at = String(fd.get("accountType")||"normal");
        updated.accountType = at;
        if(at === "admin"){
          updated.isAdmin = true;
          updated.verified = false;
        }else if(at === "certifie"){
          updated.isAdmin = false;
          updated.verified = true;
        }else{
          updated.isAdmin = false;
          updated.verified = false;
        }

        if(DB && DB.saveUser){
          await DB.saveUser(updated);
        }else if(API && API.set){
          // Fallback direct write if needed
          const list = (DB && DB.read ? DB.read('users',[]) : (users||[])).map(x=>x.id===updated.id?updated:x);
          await API.set('users', list);
        }

        if(State.me && State.me.id === updated.id){ State.me = updated; renderTopbar && renderTopbar(); }

        close();

        // Navigate if handle changed
        try{
          const after = updated.handle ? updated.handle : updated.id;
          if(location.hash.startsWith("#/channel/")){
            location.hash = "#/channel/" + encodeURIComponent(after);
          }
        }catch(_){}

        route && route();
        setTimeout(()=>{ try{ decorateUserBadgesInDom(document); }catch(_){} }, 0);
      }catch(err){
        console.error("Erreur Enregistrer:", err);
        uiAlert("Erreur pendant l'enregistrement. Voir console.");
        if(btnSave){ btnSave.disabled = false; btnSave.textContent = "Enregistrer"; }
      }
    }

    btnSave && btnSave.addEventListener('click', handleSave);
    form && form.addEventListener('submit', handleSave); // Enter key or default submit

    try{ dlg.showModal(); }catch(_){ dlg.setAttribute('open',''); }
  }catch(err){
    console.error('Admin edit dialog error', err);
    uiAlert('Erreur lors de l’ouverture du panneau administrateur.');
  }
}



/* -- Ensure page reload after admin save -- */
(function(){
  const __orig = openAdminEditUserDialog;
  openAdminEditUserDialog = function(targetId){
    __orig.call(this, targetId);
    // Override last bound save handler to reload after route
    // We attach an extra listener that fires once.
    const dlg = document.querySelector('dialog.modal[open]') || document.querySelector('dialog.modal');
    if(!dlg) return;
    const btn = dlg.querySelector('#btnSave');
    if(btn){
      btn.addEventListener('click', function onceReload(){
        // give some time for DB.saveUser + route
        setTimeout(()=>{ try{ location.reload(); }catch(_){ } }, 50);
        btn.removeEventListener('click', onceReload);
      });
    }
  };
})();




/* === User Badge Decorator (verified/admin) === */
(function(){
  // Create icons as inline SVG, sized to the font (1em), inherit color
  
  function makeBadgeIcon(type){
    const span = document.createElement('span');
    span.className = 'material-symbols-rounded user-badge ' + type;
    if(type === 'verified'){
      span.textContent = 'verified';
      span.title = 'certifié';
      span.setAttribute('aria-label', 'certifié');
      span.setAttribute('role', 'img');
    }else if(type === 'admin'){
      span.textContent = 'settings';
      span.title = 'admin';
      span.setAttribute('aria-label', 'admin');
      span.setAttribute('role', 'img');
    }
    return span;
  }
    

  function parseChannelIdFromHref(href){
    try{
      const i = href.indexOf('#/channel/');
      if(i === -1) return null;
      const part = href.slice(i + '#/channel/'.length);
      if(!part) return null;
      // strip trailing params if any
      const end = part.indexOf('?');
      const id = end>=0 ? part.slice(0,end) : part;
      return decodeURIComponent(id);
    }catch(_){ return null; }
  }

  function addBadgesToNode(node, user){
    if(!user) return;
    // Avoid duplicates
    if(node.dataset && node.dataset.badged) return;
    const toAdd = [];
    if(user.isAdmin){ toAdd.push(makeBadgeIcon('admin')); }
    if(user.verified){ toAdd.push(makeBadgeIcon('verified')); }
    if(toAdd.length){
      toAdd.forEach(el=>node.appendChild(el));
      if(node.dataset) node.dataset.badged = "1";
    }
  }

  // Main decorator: finds username nodes and appends icons
  function decorateUserBadgesInDom(root){
    if(!root) root = document;
    // 1) Anchors that go to channel pages or known name classes
    const anchors = root.querySelectorAll('a.chan, a.vh-name, a.name, a[href^="#/channel/"]:not(.avatar-link):not(.actions a)');
    anchors.forEach(a=>{
      const id = parseChannelIdFromHref(a.getAttribute('href')||'');
      if(!id) return;
      try{
        const u = (typeof getUser === 'function') ? getUser(id) : null;
        if(u) addBadgesToNode(a, u);
      }catch(_){}
    });

    // 2) Channel page header (.title-xl) — only on channel pages
    try{
      if(location.hash && location.hash.startsWith('#/channel/')){
        const id = decodeURIComponent(location.hash.split('/')[2] || '');
        const u = (typeof getUser === 'function') ? getUser(id) : null;
        if(u){
          const h = root.querySelector('.title-xl');
          if(h && h.tagName !== 'A') addBadgesToNode(h, u);
        }
      }
    }catch(_){}
  }

  // Expose globally (used elsewhere)
  window.decorateUserBadgesInDom = decorateUserBadgesInDom;

  // Start an observer so badges appear whenever the DOM updates
  function startBadgeObserver(){
    try{
      decorateUserBadgesInDom(document);
      const obs = new MutationObserver((mutations)=>{
        for(const m of mutations){
          if(m.type === 'childList'){
            m.addedNodes && m.addedNodes.forEach(n=>{
              if(n && n.nodeType === 1){
                try{ decorateUserBadgesInDom(n); }catch(_){}
              }
            });
          }
        }
      });
      obs.observe(document.body, {subtree:true, childList:true});
    }catch(_){}
  }

  window.addEventListener('load', startBadgeObserver);

  /* BADGE_comments_patch */
  (function patchComments(){
    function install(){
      try{
        if(typeof renderComments !== 'function') return false;
        const __orig = renderComments;
        renderComments = function(videoId){
          __orig(videoId);
          try{
            // Read comments again to map DOM nodes to users
            const list = (DB.read('comments',[]) || []).filter(c=>c.videoId===videoId).sort((a,b)=>b.createdAt-a.createdAt);
            const box = document.getElementById('commentsList');
            if(!box) return;
            const nodes = Array.from(box.children || []);
            nodes.forEach((el, idx)=>{
              const c = list[idx]; if(!c) return;
              const target = el.querySelector('.channel-line a[href^="#/channel/"]') || el.querySelector('.channel-line') || el;
              const u = (typeof getUser==='function') ? getUser(c.userId) : null;
              if(target && u){ addBadgesToNode(target, u); }
            });
          }catch(_){}
        };
        return true;
      }catch(_){ return false; }
    }
    if(!install()){
      // Try again a bit later if not yet defined
      setTimeout(install, 0);
      setTimeout(install, 50);
      setTimeout(install, 150);
    }
  })();
        
})();



/* === UI Enhancements Patch (likes/dislikes hover/active, sub button, admin edit styling, comment delete inline) === */
(function(){
  function enhanceVideoUI(id){
    try {
      const likeEl = document.getElementById('likeBtn');
      const dislikeEl = document.getElementById('dislikeBtn');
      const shareEl = document.getElementById('shareBtn');
      const subEl = document.getElementById('subBtn');
      const vid = id || (location.hash.match(/^#\/video\/(.+)/)||[])[1];
      if(!vid) return;
      const likesMap = DB.read('likes', {}) || {};
      const L = likesMap[vid] || {likes:[], dislikes:[]};
      const uid = State.me && State.me.id;
      const liked = !!(uid && Array.isArray(L.likes) && L.likes.includes(uid));
      const disliked = !!(uid && Array.isArray(L.dislikes) && L.dislikes.includes(uid));
      if (likeEl) likeEl.classList.toggle('like-active', liked);
      if (dislikeEl) dislikeEl.classList.toggle('dislike-active', disliked);
      [likeEl, dislikeEl, shareEl].forEach(el => { if(el){ el.classList.add('clickable'); }});

      // halo flash after click
      if (window.__flashLike === 'like' && likeEl) {
        likeEl.classList.add('halo-green');
        setTimeout(()=>{ likeEl.classList.remove('halo-green'); window.__flashLike = undefined; }, 2000);
      }
      if (window.__flashLike === 'dislike' && dislikeEl) {
        dislikeEl.classList.add('halo-red');
        setTimeout(()=>{ dislikeEl.classList.remove('halo-red'); window.__flashLike = undefined; }, 2000);
      }

      // subscribe button state on video header
      if (subEl) {
        try{
          const v = DB.read('videos',[]).find(x=>x.id===vid);
          const chId = v && v.channelId;
          const isSub = State.me && State.isSubbed(chId, State.me.id);
          subEl.classList.add('clickable','sub-enhanced');
          subEl.classList.toggle('sub-join', !isSub);
          subEl.classList.toggle('sub-leave', !!isSub);
        }catch(_){}
      }
    } catch(e){}
  }

  if (typeof viewVideo === 'function'){
    const __orig_viewVideo = viewVideo;
    viewVideo = function(id){
      __orig_viewVideo(id);
      try{
        const likeEl = document.getElementById('likeBtn');
        const dislikeEl = document.getElementById('dislikeBtn');
        if (likeEl) {
          likeEl.onclick = async ()=>{ if(!State.me) return openAuthModal('login'); window.__flashLike='like'; await State.toggleLike(id, State.me.id); // Update UI in place (no reload)
(function(){ 
  try{
    const vid = id || (location.hash.match(/^#\/video\/(.+)/)||[])[1];
    const stats = State.likeStats(vid || id);
    const likesMap = DB.read('likes', {}) || {};
    const L = likesMap[vid || id] || {likes:[], dislikes:[]};
    const uid = State.me && State.me.id;
    const likeEl = document.getElementById('likeBtn');
    const dislikeEl = document.getElementById('dislikeBtn');
    const subEl = document.getElementById('subBtn');
    var lk = document.getElementById('likeCount');
    if(lk) lk.textContent = stats.likes;
    var dk = document.getElementById('dislikeCount');
    if(dk) dk.textContent = stats.dislikes;
    if(likeEl) likeEl.classList.toggle('like-active', !!(uid && Array.isArray(L.likes) && L.likes.includes(uid)));
    if(dislikeEl) dislikeEl.classList.toggle('dislike-active', !!(uid && Array.isArray(L.dislikes) && L.dislikes.includes(uid)));
    // Update sub button + count if applicable
    try{
      const v = (DB.read('videos',[])||[]).find(x=>x.id===(vid||id));
      const chId = v && v.channelId;
      if(chId && subEl){
        const isSub = State.me && State.isSubbed(chId, State.me.id);
        subEl.classList.toggle('sub-join', !isSub);
        subEl.classList.toggle('sub-leave', !!isSub);
        (function(){
      updateSubBtnUI(subEl, isSub);
      /* preserve icon & structure */
    })();
        const subsEl = document.querySelector('.vh-subs');
        if(subsEl) subsEl.textContent = (State.subCount(chId)).toLocaleString('fr-FR') + ' abonnés';
      }
    }catch(e){}
  }catch(e){}
})(); };
        }
        if (dislikeEl) {
          dislikeEl.onclick = async ()=>{ if(!State.me) return openAuthModal('login'); window.__flashLike='dislike'; await State.toggleDislike(id, State.me.id); // Update UI in place (no reload)
(function(){ 
  try{
    const vid = id || (location.hash.match(/^#\/video\/(.+)/)||[])[1];
    const stats = State.likeStats(vid || id);
    const likesMap = DB.read('likes', {}) || {};
    const L = likesMap[vid || id] || {likes:[], dislikes:[]};
    const uid = State.me && State.me.id;
    const likeEl = document.getElementById('likeBtn');
    const dislikeEl = document.getElementById('dislikeBtn');
    const subEl = document.getElementById('subBtn');
    var lk = document.getElementById('likeCount');
    if(lk) lk.textContent = stats.likes;
    var dk = document.getElementById('dislikeCount');
    if(dk) dk.textContent = stats.dislikes;
    if(likeEl) likeEl.classList.toggle('like-active', !!(uid && Array.isArray(L.likes) && L.likes.includes(uid)));
    if(dislikeEl) dislikeEl.classList.toggle('dislike-active', !!(uid && Array.isArray(L.dislikes) && L.dislikes.includes(uid)));
    // Update sub button + count if applicable
    try{
      const v = (DB.read('videos',[])||[]).find(x=>x.id===(vid||id));
      const chId = v && v.channelId;
      if(chId && subEl){
        const isSub = State.me && State.isSubbed(chId, State.me.id);
        subEl.classList.toggle('sub-join', !isSub);
        subEl.classList.toggle('sub-leave', !!isSub);
        (function(){
      updateSubBtnUI(subEl, isSub);
      /* preserve icon & structure */
    })();
        const subsEl = document.querySelector('.vh-subs');
        if(subsEl) subsEl.textContent = (State.subCount(chId)).toLocaleString('fr-FR') + ' abonnés';
      }
    }catch(e){}
  }catch(e){}
})(); };
        }
      }catch(e){}
      setTimeout(()=>enhanceVideoUI(id), 0);
    }
  }

  if (typeof viewChannel === 'function'){
    const __orig_viewChannel = viewChannel;
    viewChannel = function(idOrHandle){
      __orig_viewChannel(idOrHandle);
      try{
        const subEl = document.getElementById('subBtn');
        const u = getUser(idOrHandle);
        const isSub = State.me && State.isSubbed(u?.id, State.me.id);
        if (subEl){
          subEl.classList.add('clickable','sub-enhanced');
          subEl.classList.toggle('sub-join', !isSub);
          subEl.classList.toggle('sub-leave', !!isSub);
        }
        // Add admin-edit class to "modifier chaine" if present
        const abtn = Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().toLowerCase().includes('modifier chaine'));
        if (abtn) abtn.classList.add('admin-edit');
      }catch(e){}
    }
  }

  if (typeof renderComments === 'function'){
    const __orig_renderComments = renderComments;
    renderComments = function(videoId){
      __orig_renderComments(videoId);
      try{
        const listBox = document.getElementById('commentsList');
        if (!listBox) return;
        // match order
        let comments = (DB.read('comments',[])||[]).filter(c=>c.videoId===videoId).sort((a,b)=>b.createdAt-a.createdAt);
        const nodes = Array.from(listBox.children);
        nodes.forEach((node, idx)=>{
          const c = comments[idx];
          if (!c) return;
          node.dataset.commentId = c.id || (c._id || String(idx));
          if (State.me && State.me.isAdmin) {
            const meta = node.querySelector('.statline') || node;
            if (meta && !node.querySelector('.comment-delete-mini')) {
              const del = document.createElement('button');
              del.className = 'comment-delete-mini';
              del.type='button';
              del.textContent = 'Supprimer';
              del.title = 'Supprimer ce commentaire';
              del.addEventListener('click', async (ev)=>{
                ev.preventDefault(); ev.stopPropagation();
                let all = DB.read('comments',[]);
                all = all.filter(x=> x !== c && x.id !== c.id && !(x.videoId===c.videoId && x.userId===c.userId && x.createdAt===c.createdAt && x.text===c.text));
                await DB.write('comments', all);
                renderComments(videoId);
              });
              meta.insertAdjacentElement('afterend', del);
            }
          }
        });
      }catch(e){}
    }
  }
})();



/* --- Added by assistant: click pulse halo for like/dislike --- */
(function(){
  document.addEventListener('click', function(e){
    var t = e.target && e.target.closest ? e.target.closest('#likeBtn, #dislikeBtn') : null;
    if(!t) return;
    var cls = (t.id === 'likeBtn') ? 'pulse-like' : 'pulse-dislike';
    // restart animation
    t.classList.remove(cls);
    void t.offsetWidth; // force reflow
    t.classList.add(cls);
    var once = function(){
      t.classList.remove(cls);
      t.removeEventListener('animationend', once);
    };
    t.addEventListener('animationend', once);
  }, true);
})();


/* --- Subscribe button UI helper --- */
function updateSubBtnUI(subEl, isSub){
  try{
    if(!subEl) return;
    var icon = subEl.querySelector && subEl.querySelector('.material-symbols-rounded');
    var label = subEl.querySelector && subEl.querySelector('.label');
    if(!icon || !label){
      subEl.innerHTML = '<span class="material-symbols-rounded"></span><span class="label"></span>';
      icon = subEl.querySelector('.material-symbols-rounded');
      label = subEl.querySelector('.label');
    }
    if(icon) icon.textContent = isSub ? 'person_remove' : 'person_add';
    if(label) label.textContent = isSub ? 'Se désabonner' : "S'abonner";
  }catch(e){}
}


function openAdsModal(existing){
  if(!State.me) return openAuthModal('login');
  if(!isAdminUser(State.me)) return;

  const dlg = $("#adsModal");
  const isEdit = !!existing;
  const init = existing || { url:"", title:"", desc:"", thumb:"", durationSec:"", activeUntil:"", createdFor:"" };

  dlg.innerHTML = `
    <header class="pm-header">
      <div class="pm-title"><strong>${isEdit ? "Modifier la publicité" : "Ajouter une publicité"}</strong></div>
      <button class="icon-button pm-close" title="Fermer"><span class="material-symbols-rounded">close</span></button>
    </header>
    <div class="pm-sep"></div>
    <div class="pm-toplink">
      <input id="ad-url" class="pm-url-input" type="url" placeholder="Lien de la vidéo publicitaire (obligatoire)" value="${escapeHtml(init.url||'')}">
    </div>
    <div class="pm-body">
      <div class="pm-left">
        <label class="pm-label">Titre</label>
        <input id="ad-title" type="text" placeholder="Titre de la publicité (obligatoire)" value="${escapeHtml(init.title||'')}">
        <label class="pm-label">Description <span class="pm-optional">(facultatif)</span></label>
        <textarea id="ad-desc" placeholder="Description de la publicité">${escapeHtml(init.desc||'')}</textarea>
        <label class="pm-label">Miniature (URL) <span class="pm-optional">(facultatif)</span></label>
        <input id="ad-thumb" type="url" placeholder="https://..." value="${escapeHtml(init.thumb||'')}">
        <label class="pm-label">Créé pour (client / marque)</label>
        <input id="ad-for" type="text" placeholder="ex: Marque X, Événement Y" value="${escapeHtml(init.createdFor||'')}">
        <div style="display:grid;grid-template-columns:1fr 1fr; gap:12px">
          <div>
            <label class="pm-label">Durée de la pub (secondes) <span class="pm-optional" style="color:#e88">(obligatoire)</span></label>
            <input id="ad-duration" type="number" min="1" step="1" placeholder="ex: 15" value="${init.durationSec||''}">
          </div>
          <div>
            <label class="pm-label">Diffusion jusqu'au <span class="pm-optional" style="color:#e88">(obligatoire)</span></label>
            <input id="ad-until" type="date" value="${(init.activeUntil||'').toString().slice(0,10)}">
          </div>
        </div>
      </div>
      <div class="pm-right">
        <div class="pm-details-title">Aperçu</div>
        <div class="pm-preview">
          <div id="ad-thumb-rect" class="pm-thumb-rect"></div>
          <div class="pm-vname-label">Nom</div>
          <div id="ad-vname" class="pm-vname">—</div>
        </div>
      </div>
    </div>
    <div class="pm-footer">
      <button class="btn" id="ad-cancel">Annuler</button>
      <button class="btn primary" id="ad-submit">${isEdit ? "Enregistrer" : "Créer la pub"}</button>
    </div>
  `;

  const $url = $("#ad-url", dlg);
  const $title = $("#ad-title", dlg);
  const $desc = $("#ad-desc", dlg);
  const $thumb = $("#ad-thumb", dlg);
  const $dur = $("#ad-duration", dlg);
  const $until = $("#ad-until", dlg);
  const $for = $("#ad-for", dlg);
  const $vname = $("#ad-vname", dlg);
  const $thumbRect = $("#ad-thumb-rect", dlg);

  function updatePreview(){
    const t = ($title.value||"").trim();
    $vname.textContent = t || "—";
    const src = ($thumb.value||"").trim();
    if(src){
      $thumbRect.style.backgroundImage = `url("${src}")`;
      $thumbRect.classList.add("has-img");
    }else{
      $thumbRect.style.backgroundImage = "";
      $thumbRect.classList.remove("has-img");
    }
  }
  $title.addEventListener('input', updatePreview);
  $thumb.addEventListener('input', updatePreview);
  updatePreview();

  dlg.querySelector('.pm-close').onclick = ()=> dlg.close();
  $("#ad-cancel", dlg).onclick = ()=> dlg.close();
  $("#ad-submit", dlg).onclick = async ()=>{
    const url = $url.value.trim();
    const title = $title.value.trim();
    const desc = $desc.value.trim();
    const thumb = $thumb.value.trim();
    const createdFor = $for.value.trim();
    const dur = parseInt($dur.value||'0',10);
    const untilRaw = $until.value;
    if(!title){ uiAlert("Le titre est obligatoire."); return; }
    if(!url){ uiAlert("Le lien de la vidéo est obligatoire."); return; }
    if(!(dur > 0)){ uiAlert("La durée de la pub est obligatoire (en secondes)."); return; }
    if(!untilRaw){ uiAlert("La date de fin de diffusion est obligatoire."); return; }
    const until = new Date(untilRaw).toISOString().slice(0,10);

    const now = Date.now();
    const base = existing || { id: uid(), createdAt: now, createdBy: State.me.id, views: 0 };
    const ad = Object.assign({}, base, {
      url, title, desc, thumb, durationSec: dur, activeUntil: until, createdFor
    });
    await State.saveAd(ad);
    dlg.close();
    route();
  };

  dlg.showModal();
}



// --- Pre‑roll ads (overlay version) ---
function viewVideo(id, __noPreRoll){
  const allAds = (State.ads()||[]).filter(a=>{
    try{
      const untilOk = !a.activeUntil || (new Date(a.activeUntil+'T23:59:59').getTime() >= Date.now());
      return untilOk && !!a.url && parseInt(a.durationSec,10) > 0;
    }catch(e){ return false; }
  });
  // Render original page first
  __orig_viewVideo(id);

  
  // Visibility & protection gate BEFORE ads
  try{
    const v = (DB.read('videos',[])||[]).find(x=>x.id===id);

// BLOCKED gate (before ads, before anything else interactive)
try{
  if(v && v.blocked){
    const player = document.getElementById('player');
    if(player){
      player.innerHTML = '<img src="bloque.svg" alt="Vidéo bloquée" style="width:100%;height:100%;object-fit:contain">';
    }
    // disable preroll
    window.__noPreRoll = true;
    // optionally we could disable buttons, but spec only requires no preroll and replaced player
    return;
  }
}catch(e){}

    const vis = (v && v.visibilite) || "publique";
    const currentPass = String(v && v.visipass || "");
    // Unlock cache must match current password: if changed, force re-enter
    const _k = "videoUnlocks";
    let unlocks = {};
    try{ unlocks = JSON.parse(localStorage.getItem(_k)||"{}")||{}; }catch(_){}
    const saved = unlocks[id];
    const isUnlocked = saved && saved.pass === currentPass;

    const player = document.getElementById('player');
    const rightbox = document.querySelector('.rightbox');
    const lockUI = ()=>{
      // background thumbnail on player + center protect-box
      try{
        if(player){
          if(v && v.thumb){
            player.style.background = `url('${v.thumb}') center/cover no-repeat`;
          }
          player.classList.add('protected-player');
        }
      }catch(e){}
      // Replace right pane content with "vidéo protégée" notice
      try{
        if(rightbox){
          const box = document.createElement('div');
          box.className = 'card protect-info';
          box.innerHTML = `<div class="section-title">vidéo protégée</div><div class="pad">Contenu indisponible tant que la vidéo n\'est pas déverrouillée.</div>`;
          // Replace first card in rightbox if present; else append
          const first = rightbox.querySelector('.card');
          if(first) first.replaceWith(box); else rightbox.appendChild(box);
        }
      }catch(e){}
      // Disable action buttons
      try{
        ["likeBtn","dislikeBtn","shareBtn"].forEach(id=>{
          const el = document.getElementById(id);
          if(el){ el.classList.add('is-locked'); el.setAttribute('disabled',''); el.style.pointerEvents='none'; el.style.opacity='0.6'; }
        });
        // Disable tab buttons (description/comments)
        document.querySelectorAll('#tabDesc, #tabCom').forEach(b=>{
          b.classList.add('is-locked'); b.setAttribute('disabled',''); b.style.pointerEvents='none'; b.style.opacity='0.6';
        });
        const tc = document.getElementById('tabContent'); if(tc){ tc.innerHTML=''; tc.classList.add('locked'); }
      }catch(e){}
    };

    if(vis==="protégé" && !isUnlocked){
      if(player){
        player.innerHTML = `<div class="protect-box">
  <div class="protect-title">Cette vidéo est protégée</div>
  <form id="protForm" class="protect-form">
    <input id="protInput" type="password" placeholder="Mot de passe">
    <button class="btn primary" type="submit">Valider</button>
  </form>
  <div id="protError" class="protect-error" style="display:none">Mot de passe incorrect</div>
</div>`;
        // Center the box (via flex on player)
        player.style.display='flex'; player.style.alignItems='center'; player.style.justifyContent='center';
      }
      lockUI();
      const form = document.getElementById('protForm');
      if(form){
        form.onsubmit = (e)=>{
          e.preventDefault();
          const val = (document.getElementById('protInput')||{}).value || "";
          if(String(val) === currentPass){
            try{ unlocks[id] = { pass: currentPass, ts: Date.now() }; localStorage.setItem(_k, JSON.stringify(unlocks)); }catch(_){}
            viewVideo(id, true);
          }else{
            const err = document.getElementById('protError'); if(err) err.style.display='';
          }
        };
      }
      // do not continue (also prevents preroll)
      return;
    }
    // For private or protected (even unlocked), do not show preroll ads
    if(vis==="privé" || vis==="protégé"){ __noPreRoll = true; }
  }catch(e){}const showAd = !__noPreRoll && allAds.length>0 && Math.random()<0.5;
  if(!showAd) return;

  const ad = allAds[Math.floor(Math.random()*allAds.length)];
  const player = document.getElementById('player');
  const right = document.querySelector('.rightbox');
  if(!player || !right) return;

  const yt = getYouTubeId(ad.url);
  const adPlayerHTML = yt
    ? `<iframe src="https://www.youtube.com/embed/${yt}?autoplay=1&mute=0&playsinline=1&enablejsapi=1&rel=0&modestbranding=1"
         frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
         allowfullscreen></iframe>`
    : `<video autoplay playsinline src="${ad.url}" poster="${ad.thumb||''}"></video>`;

  player.classList.add('ad-has-overlay');
  const pOv = document.createElement('div');
  pOv.className = 'ad-overlay';
  pOv.innerHTML = `<div class="ad-wrapper">${adPlayerHTML}
      <div class="ad-skip" id="adSkipBox">Ignorez dans <span id="adSkipTimer">${parseInt(ad.durationSec,10)}</span>s</div>
    </div>`;
  player.appendChild(pOv);

  right.classList.add('ad-has-overlay');
  const rOv = document.createElement('div');
  rOv.className = 'ad-right-overlay';
  rOv.innerHTML = `
    <div class="ad-info-card card">
      <div class="ad-badge">PUBLICITÉ</div>
      <div class="ad-thumb-wrap"><img class="ad-thumb" src="${ad.thumb||'assets/placeholder.svg'}" alt="${escapeHtml(ad.title||'Publicité')}"></div>
      <div class="ad-texts">
        <div class="ad-title">${escapeHtml(ad.title||'')}</div>
        <div class="ad-desc">${escapeHtml((ad.desc||'').toString())}</div>
      </div>
    </div>
  `;
  right.appendChild(rOv);
  // Increment ad views counter & persist
  try{
    ad.views = (ad.views||0) + 1;
    (async()=>{ try{ await State.saveAd(ad); }catch(e){} })();
  }catch(e){}

  // Attempt to ensure audible playback for both HTML5 and YouTube embeds
  function attemptAudiblePlayback(){
    try{
      const vidEl = pOv.querySelector('video');
      if(vidEl){
        vidEl.muted = false;
        vidEl.volume = 1.0;
        const p = vidEl.play();
        if(p && typeof p.then === 'function'){ p.catch(()=>{}); }
        return;
      }
      const iframe = pOv.querySelector('iframe');
      if(iframe){
        // YouTube IFrame API via postMessage (enablejsapi=1 required)
        try{
          const cmds = [
            {event:'command', func:'unMute', args:[]},
            {event:'command', func:'setVolume', args:[100]},
            {event:'command', func:'playVideo', args:[]}
          ];
          cmds.forEach(c=> iframe.contentWindow && iframe.contentWindow.postMessage(JSON.stringify(c), '*'));
        }catch(e){}
      }
    }catch(e){}
  }
  attemptAudiblePlayback();
  // Fallback: if browser blocks autoplay with sound, retry on first user interaction
  const _onceEnableSound = (ev)=>{
    try{ attemptAudiblePlayback(); }catch(e){}
    document.removeEventListener('pointerdown', _onceEnableSound, {capture:true});
    document.removeEventListener('keydown', _onceEnableSound, {capture:true});
    document.removeEventListener('touchstart', _onceEnableSound, {capture:true});
  };
  document.addEventListener('pointerdown', _onceEnableSound, {once:true, capture:true});
  document.addEventListener('keydown', _onceEnableSound, {once:true, capture:true});
  document.addEventListener('touchstart', _onceEnableSound, {once:true, capture:true});

  // Increment ad views counter & persist
  try{
    ad.views = (ad.views||0) + 1;
    (async()=>{ try{ await State.saveAd(ad); }catch(e){} })();
  }catch(e){}

  // Try to unmute HTML5 video and ensure playback with sound
  try{
    const vidEl = pOv.querySelector('video');
    if(vidEl){
      vidEl.muted = false;
      vidEl.volume = 1.0;
      const playPromise = vidEl.play();
      if(playPromise && typeof playPromise.then === 'function'){
        playPromise.catch(()=>{ /* autoplay with sound might be blocked */ });
      }
    }
  }catch(e){}


  let remaining = parseInt(ad.durationSec,10) || 0;
  const timerEl = pOv.querySelector('#adSkipTimer');
  const boxEl = pOv.querySelector('#adSkipBox');

  function cleanup(){
    try{
      if(pOv && pOv.parentNode){ pOv.parentNode.removeChild(pOv); }
      if(rOv && rOv.parentNode){ rOv.parentNode.removeChild(rOv); }
      player.classList.remove('ad-has-overlay');
      right.classList.remove('ad-has-overlay');
    }catch(e){}
  }

  function enableSkip(){
    if(!boxEl) return;
    boxEl.classList.add('clickable');
    boxEl.textContent = 'Passer la pub ⏯';
    boxEl.onclick = cleanup;
  }

  const intId = setInterval(()=>{
    remaining -= 1;
    if(timerEl) timerEl.textContent = remaining;
    if(remaining<=0){ clearInterval(intId); enableSkip(); }
  }, 1000);

  try{
    const vid = pOv.querySelector('video');
    if(vid){ vid.addEventListener('ended', ()=>{ cleanup(); }, { once:true }); }
  }catch(e){}
}


/* --- Topbar auto-hide with large threshold to avoid jitter when scrolling deep --- */
(function(){
  try{
    var header = document.querySelector('#topbar') || document.querySelector('.topbar') || document.querySelector('header');
    if(!header) return;
    var THRESHOLD = 8000; // pixels to scroll before auto-hide kicks in (very large on purpose)
    window.addEventListener('scroll', function(){
      var y = window.scrollY || window.pageYOffset || 0;
      if(y > THRESHOLD){ header.classList.add('autohide'); }
      else{ header.classList.remove('autohide'); }
    }, { passive: true });
  }catch(e){ /* no-op */ }
})();


/* === Final responsive/mobile/comments patch === */
(function(){
  const MOBILE_BREAKPOINT = 980;

  function isMobileWidth(){
    return (window.innerWidth || document.documentElement.clientWidth || 0) <= MOBILE_BREAKPOINT;
  }

  function syncMobileSearchState(){
    if(!isMobileWidth()){
      document.body.classList.remove('search-open');
    }
  }

  function openMobileSearch(){
    if(!isMobileWidth()) return;
    document.body.classList.add('search-open');
    const input = document.getElementById('searchInput');
    if(input){
      setTimeout(()=>{
        try{ input.focus(); input.select(); }catch(e){}
      }, 20);
    }
  }

  function closeMobileSearch(){
    document.body.classList.remove('search-open');
  }

  function setupMobileSearch(){
    const form = document.getElementById('searchForm');
    const input = document.getElementById('searchInput');
    if(!form || form.dataset.mobileSearchPatched) return;
    form.dataset.mobileSearchPatched = '1';

    // Add back button for mobile search expanded state
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'search-back';
    backBtn.innerHTML = '<span class="material-symbols-rounded">arrow_back</span>';
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMobileSearch();
    });
    form.insertBefore(backBtn, form.firstChild);

    form.addEventListener('submit', (e)=>{
      if(isMobileWidth() && !document.body.classList.contains('search-open')){
        e.preventDefault();
        openMobileSearch();
        return;
      }
      if(isMobileWidth() && document.body.classList.contains('search-open') && !String(input?.value || '').trim()){
        e.preventDefault();
        closeMobileSearch();
      }
    });

    form.addEventListener('click', (e)=>{
      const btn = e.target.closest('button');
      if(btn && isMobileWidth() && !document.body.classList.contains('search-open')){
        e.preventDefault();
        openMobileSearch();
      }
    });

    if(input){
      input.addEventListener('focus', ()=>{
        if(isMobileWidth()) document.body.classList.add('search-open');
      });
      input.addEventListener('keydown', (e)=>{
        if(e.key === 'Escape'){
          e.preventDefault();
          closeMobileSearch();
        }
      });
    }

    document.addEventListener('click', (e)=>{
      if(!isMobileWidth() || !document.body.classList.contains('search-open')) return;
      if(e.target.closest('#searchForm')) return;
      closeMobileSearch();
    });

    window.addEventListener('resize', syncMobileSearchState, { passive:true });
    window.addEventListener('hashchange', closeMobileSearch, { passive:true });
    syncMobileSearchState();
  }

  function setupMobileSidebar(){
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    if(!menuBtn || !sidebar || menuBtn.dataset.sidebarPatched) return;
    menuBtn.dataset.sidebarPatched = '1';

    menuBtn.onclick = ()=>{
      const willOpen = !sidebar.classList.contains('open');
      sidebar.classList.toggle('open', willOpen);
      document.body.classList.toggle('sidebar-open', willOpen);
      closeMobileSearch();
    };

    document.addEventListener('click', (e)=>{
      if(!isMobileWidth()) return;
      if(!sidebar.classList.contains('open')) return;
      if(e.target.closest('#sidebar') || e.target.closest('#menuBtn')) return;
      sidebar.classList.remove('open');
      document.body.classList.remove('sidebar-open');
    });

    window.addEventListener('resize', ()=>{
      if(!isMobileWidth()){
        sidebar.classList.remove('open');
        document.body.classList.remove('sidebar-open');
      }
    }, { passive:true });
  }

  setupMobileSearch();
  setupMobileSidebar();
})();

__orig_viewVideo = function(id){
  const v = (DB.read('videos',[]) || []).find(x=>x.id===id);
  if(!v){
    $app().innerHTML = `<div class="feed-empty">Vidéo introuvable.</div>`;
    return;
  }

  const ch = getUser(v.channelId) || {};
  const isSubbed = !!(State.me && ch.id && State.isSubbed(ch.id, State.me.id));
  const adminActions = (State.me && State.me.isAdmin)
    ? `<div class="badge block-btn" id="blockBtn">${v.blocked ? 'débloquer' : 'bloquer'}</div>
       <div class="badge sponso-btn" id="sponsoBtn">sponso</div>`
    : '';

  $app().innerHTML = `
    <div class="video-layout video-page">
      <section class="video-main">
        <div class="player" id="player"></div>
        <div class="title-xl">${escapeHtml(v.title || 'Sans titre')}</div>

        <div class="video-header">
          <div class="vh-left">
            <div class="vh-avatar"></div>
            <div class="vh-texts">
              <a class="vh-name" href="#/channel/${encodeURIComponent(ch.handle || ch.id || '')}">${escapeHtml(ch?.pseudo || 'Utilisateur')}</a>
              <div class="vh-subs">${formatNumber(State.subCount(ch?.id))} abonnés</div>
            </div>
            <button class="badge" id="subBtn" type="button"></button>
          </div>
          <div class="vh-right">
            <div class="inline-actions">
              ${adminActions}
              <button class="badge" id="likeBtn" type="button"><span class="material-symbols-rounded">thumb_up</span> J'aime (<span id="likeCount">0</span>)</button>
              <button class="badge" id="dislikeBtn" type="button"><span class="material-symbols-rounded">thumb_down</span> Je déteste (<span id="dislikeCount">0</span>)</button>
              <button class="badge" id="shareBtn" type="button"><span class="material-symbols-rounded">cast</span> Diffuser</button>
            </div>
          </div>
        </div>
      </section>

      <aside class="rightbox">
        <div class="tabs">
          <button id="tabDesc" class="active" type="button">Description</button>
          <button id="tabCom" type="button">Commentaires</button>
        </div>
        <div class="tabcontent" id="tabContent"></div>
      </aside>
    </div>`;

  const player = document.getElementById('player');
  const yt = getYouTubeId(v.url);
  player.innerHTML = yt
    ? `<iframe src="https://www.youtube.com/embed/${yt}" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`
    : `<video controls src="${v.url}" poster="${v.thumb || ''}"></video>`;

  try{
    const _tid = setTimeout(async ()=>{
      try{ await State.addView(v.id); }catch(e){}
    }, 10000);
    const _clear = ()=>{ try{ clearTimeout(_tid); }catch(e){} window.removeEventListener('hashchange', _clear); };
    window.addEventListener('hashchange', _clear, { once:true });
  }catch(e){}

  const vhAv = document.querySelector('.vh-avatar');
  if(vhAv) vhAv.replaceWith(makeAvatarElement(ch, 40));

  function refreshVideoUi(){
    const stats = State.likeStats(v.id);
    const likesMap = DB.read('likes', {}) || {};
    const state = likesMap[v.id] || { likes:[], dislikes:[] };
    const uid = State.me && State.me.id;
    const likeBtn = document.getElementById('likeBtn');
    const dislikeBtn = document.getElementById('dislikeBtn');
    const subBtn = document.getElementById('subBtn');
    const likeCount = document.getElementById('likeCount');
    const dislikeCount = document.getElementById('dislikeCount');
    const subsEl = document.querySelector('.vh-subs');
    if(likeCount) likeCount.textContent = String(stats.likes || 0);
    if(dislikeCount) dislikeCount.textContent = String(stats.dislikes || 0);
    if(likeBtn) likeBtn.classList.toggle('like-active', !!(uid && Array.isArray(state.likes) && state.likes.includes(uid)));
    if(dislikeBtn) dislikeBtn.classList.toggle('dislike-active', !!(uid && Array.isArray(state.dislikes) && state.dislikes.includes(uid)));
    if(subBtn){
      const subbed = !!(State.me && ch.id && State.isSubbed(ch.id, State.me.id));
      subBtn.classList.add('clickable','sub-enhanced');
      subBtn.classList.toggle('sub-join', !subbed);
      subBtn.classList.toggle('sub-leave', subbed);
      updateSubBtnUI(subBtn, subbed);
    }
    if(subsEl) subsEl.textContent = `${formatNumber(State.subCount(ch?.id))} abonnés`;
  }

  refreshVideoUi();

  try{
    const bb = document.getElementById('blockBtn');
    if(bb && State.me && State.me.isAdmin){
      bb.onclick = async ()=>{
        try{
          const vids = DB.read('videos',[]) || [];
          const idx = vids.findIndex(x=>x.id===id);
          if(idx < 0) return;
          const cur = vids[idx] || {};
          const newBlocked = !Boolean(cur.blocked);
          vids[idx] = Object.assign({}, cur, { blocked:newBlocked });
          await API.set('videos', vids);
          DB.cache.videos = vids;
          bb.textContent = newBlocked ? 'débloquer' : 'bloquer';
          if(newBlocked && player){
            window.__noPreRoll = true;
            player.innerHTML = '<img src="bloque.svg" alt="Vidéo bloquée" style="width:100%;height:100%;object-fit:contain">';
          }else{
            route();
          }
        }catch(e){ console.warn('block toggle failed', e); }
      };
    }
  }catch(e){}

  try{
    const sb = document.getElementById('sponsoBtn');
    if(sb && State.me && State.me.isAdmin){
      sb.onclick = async ()=>{
        const dlg = document.createElement('dialog');
        dlg.className = 'modal';
        dlg.innerHTML = `
          <header><strong>Sponsoriser la vidéo</strong><button class="icon-button" id="closeSponso"><span class="material-symbols-rounded">close</span></button></header>
          <div class="body">
            <label>Fin de sponsorisation
              <input type="date" id="sponsoDate">
            </label>
            <div class="actions">
              <button class="btn" id="sponsoRemove">Retirer</button>
              <div class="spacer"></div>
              <button class="btn primary" id="sponsoSave">Valider</button>
            </div>
            <div id="sponsoNote" class="statline"></div>
          </div>`;
        document.body.appendChild(dlg);
        dlg.showModal();
        const close = ()=>{ try{ dlg.close(); dlg.remove(); }catch(e){} };
        dlg.querySelector('#closeSponso').onclick = close;
        const currentUntil = (DB.read('sponso', {}) || {})[v.id] || 0;
        if(currentUntil && currentUntil > Date.now()){
          dlg.querySelector('#sponsoNote').textContent = 'Actuellement sponsorisé jusqu\'au ' + (new Date(currentUntil)).toLocaleDateString();
        }else{
          dlg.querySelector('#sponsoRemove').style.display = 'none';
        }
        dlg.querySelector('#sponsoSave').onclick = async ()=>{
          const dateStr = (dlg.querySelector('#sponsoDate') || {}).value || '';
          if(!dateStr){ uiAlert('Choisissez une date.'); return; }
          const untilTs = new Date(dateStr + 'T23:59:59').getTime();
          await State.setSponso(v.id, untilTs);
          close();
          route();
        };
        dlg.querySelector('#sponsoRemove').onclick = async ()=>{
          await State.setSponso(v.id, 0);
          close();
          route();
        };
      };
    }
  }catch(e){}

  const likeBtn = document.getElementById('likeBtn');
  const dislikeBtn = document.getElementById('dislikeBtn');
  const subBtn = document.getElementById('subBtn');
  const shareBtn = document.getElementById('shareBtn');

  if(likeBtn){
    likeBtn.onclick = async ()=>{
      if(!State.me) return openAuthModal('login');
      await State.toggleLike(v.id, State.me.id);
      refreshVideoUi();
      try{ likeBtn.classList.remove('pulse-like'); void likeBtn.offsetWidth; likeBtn.classList.add('pulse-like'); }catch(e){}
    };
  }
  if(dislikeBtn){
    dislikeBtn.onclick = async ()=>{
      if(!State.me) return openAuthModal('login');
      await State.toggleDislike(v.id, State.me.id);
      refreshVideoUi();
      try{ dislikeBtn.classList.remove('pulse-dislike'); void dislikeBtn.offsetWidth; dislikeBtn.classList.add('pulse-dislike'); }catch(e){}
    };
  }
  if(subBtn){
    subBtn.onclick = async ()=>{
      if(!State.me) return openAuthModal('login');
      await State.toggleSub(ch.id, State.me.id);
      refreshVideoUi();
    };
  }
  if(shareBtn){
    shareBtn.onclick = async ()=>{
      try{ await navigator.clipboard.writeText(v.url); uiAlert('URL de la vidéo copiée'); }
      catch(e){ uiAlert('Impossible de copier le lien.'); }
    };
  }

  const showDesc = ()=>{
    const tags = (v.tags || []).map(t=>`<span class="chip">#${escapeHtml(t)}</span>`).join(' ');
    const meta = `<div class="desc-meta"><strong>${formatNumber(State.views(v.id))} vues</strong> • ${timeAgo(v.createdAt)} ${tags ? `• ${tags}` : ''}</div>`;
    document.getElementById('tabContent').innerHTML = `${meta}<p>${linkify(escapeHtml((v.desc || v.description || ''))).replaceAll('\n','<br>')}</p>`;
  };

  const showComments = ()=> renderComments(v.id);
  const tabDesc = document.getElementById('tabDesc');
  const tabCom = document.getElementById('tabCom');
  if(tabDesc) tabDesc.onclick = (e)=>{ document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active')); e.currentTarget.classList.add('active'); showDesc(); };
  if(tabCom) tabCom.onclick = (e)=>{ document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active')); e.currentTarget.classList.add('active'); showComments(); };
  showDesc();

  try{
    if(State.me && State.me.isAdmin){
      const host = document.querySelector('.inline-actions');
      if(host && !host.querySelector('.admin-edit')){
        const vbtn = document.createElement('button');
        vbtn.className = 'badge admin-edit';
        vbtn.type = 'button';
        vbtn.textContent = 'modifier video';
        vbtn.addEventListener('click', (e)=>{
          e.preventDefault();
          e.stopPropagation();
          openEditVideoModal(id);
        });
        host.appendChild(vbtn);
      }
    }
  }catch(e){}
};

renderComments = function(videoId){
  const box = document.getElementById('tabContent');
  if(!box) return;

  const list = (DB.read('comments',[]) || []).filter(c=>c.videoId===videoId).sort((a,b)=>b.createdAt-a.createdAt);
  const me = State.me;
  const meAvatar = me ? avatarSrcOrInitial(me) : 'assets/placeholder.svg';

  box.innerHTML = `
    <section class="comments-shell">
      <div class="comments-header">
        <div class="comments-count">${formatNumber(list.length)} commentaire${list.length > 1 ? 's' : ''}</div>
        <button class="comment-sort" type="button"><span class="material-symbols-rounded">sort</span> Trier par</button>
      </div>

      ${me ? `
        <div class="comment-composer">
          <img class="composer-avatar" src="${meAvatar}" alt="Votre profil">
          <form id="commentForm">
            <input name="text" maxlength="500" placeholder="Ajoutez un commentaire..." autocomplete="off">
            <div class="composer-actions">
              <button class="btn" type="button" id="commentCancelBtn">Annuler</button>
              <button class="btn primary" type="submit">Commenter</button>
            </div>
          </form>
        </div>`
      : `<div class="feed-empty">Connectez-vous pour commenter.</div>`}

      <div class="comments-list" id="commentsList"></div>
    </section>`;

  const listBox = document.getElementById('commentsList');
  if(!list.length){
    listBox.innerHTML = `<div class="feed-empty">Aucun commentaire.</div>`;
  }else{
    list.forEach(c=>{
      const u = getUser(c.userId) || {};
      const avatar = avatarSrcOrInitial(u);
      const row = document.createElement('article');
      row.className = 'yt-comment';
      row.dataset.commentId = c.id || '';
      row.innerHTML = `
        <img class="comment-avatar" src="${avatar}" alt="${escapeHtml(u.pseudo || 'Utilisateur')}">
        <div class="yt-comment-body">
          <div class="yt-comment-meta">
            <strong class="yt-comment-author">@${escapeHtml(u.pseudo || 'utilisateur')}</strong>
            <span class="yt-comment-time statline">${timeAgo(c.createdAt)}</span>
          </div>
          <div class="yt-comment-text">${escapeHtml(c.text || '')}</div>
          <div class="yt-comment-actions">
            <button class="icon-button" type="button" aria-label="J'aime"><span class="material-symbols-rounded">thumb_up</span><span class="action-count">0</span></button>
            <button class="icon-button" type="button" aria-label="Je n'aime pas"><span class="material-symbols-rounded">thumb_down</span></button>
            <button class="comment-reply" type="button">Répondre</button>
            ${State.me && State.me.isAdmin ? '<button class="comment-delete-btn" type="button">Supprimer</button>' : ''}
          </div>
        </div>
        <button class="comment-more" type="button"><span class="material-symbols-rounded">more_vert</span></button>`;

      const img = row.querySelector('.comment-avatar');
      if(img){
        img.onerror = ()=>{ img.src = avatarSrcOrInitial(u); };
      }

      const delBtn = row.querySelector('.comment-delete-btn');
      if(delBtn){
        delBtn.addEventListener('click', async (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          if(!await uiConfirm('Supprimer ce commentaire ?')) return;
          let all = DB.read('comments',[]) || [];
          all = all.filter(x=> x.id !== c.id);
          await DB.write('comments', all);
          renderComments(videoId);
        });
      }

      listBox.appendChild(row);
    });
  }

  const form = document.getElementById('commentForm');
  const input = form && form.elements && form.elements.text;
  const cancelBtn = document.getElementById('commentCancelBtn');

  if(cancelBtn && input){
    cancelBtn.onclick = ()=>{ input.value = ''; input.blur(); };
  }

  if(form && input){
    form.onsubmit = async (e)=>{
      e.preventDefault();
      const text = String(new FormData(form).get('text') || '').trim();
      if(!text) return;
      await State.saveComment({ id:uid(), videoId, userId:State.me.id, text, createdAt:Date.now() });
      try{
        const v = (DB.read('videos',[]) || []).find(video=>video.id===videoId);
        const notes = DB.read('notifications',{}) || {};
        if(v){
          notes[v.channelId] ??= [];
          notes[v.channelId].push(`Nouveau commentaire sur "${v.title}" par ${State.me.pseudo}`);
          await DB.write('notifications', notes);
        }
      }catch(err){}
      renderComments(videoId);
    };
  }
};


(function(){
  const sidebar = document.getElementById('sidebar');
  if(sidebar){
    window.addEventListener('hashchange', ()=>{
      sidebar.classList.remove('open');
      document.body.classList.remove('sidebar-open');
    }, { passive:true });
    sidebar.addEventListener('click', (e)=>{
      if(e.target.closest('a')){
        sidebar.classList.remove('open');
        document.body.classList.remove('sidebar-open');
      }
    });
  }
})();
