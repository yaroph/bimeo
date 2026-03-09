/* YouVid (server-backed) */
const $ = (s, r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const API = {
  async get(key){ const res = await fetch(`/api/get?key=${encodeURIComponent(key)}`); const j = await res.json(); return j.value },
  async set(key, value){ await fetch('/api/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,value})}); },
  async getStore(){ const res = await fetch('/api/store'); return await res.json(); }
};

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
function avatarSrcOrInitial(u){
  if(u && u.photo){ return u.photo; }
  const initials = _initials(u);
  const bg = _colorFromString(String(u?.id||u?.pseudo||'x'));
  return _svgAvatarDataURL(initials, bg);
}
// --- end helpers ---

const DB = {
  cache: { users:[], videos:[], comments:[], likes:{}, views:{}, subs:{}, notifications:{} },
  async init(){
    try{ this.cache = await API.getStore(); }catch(e){ console.error('API down?', e); }
    if(!this.cache || !this.cache.users) this.cache = { users:[], videos:[], comments:[], likes:{}, views:{}, subs:{}, notifications:{} };
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
      await API.set('notifications', {});
    }
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
  async saveVideo(v){ const list = DB.read('videos',[]); const i=list.findIndex(x=>x.id===v.id); if(i>=0) list[i]=v; else list.push(v); await DB.write('videos',list) },
  comments(){ return DB.read('comments',[]) },
  async saveComment(c){ const list = DB.read('comments',[]); list.push(c); await DB.write('comments',list) },
  likeStats(id){ const L = DB.read('likes',{})[id] || {likes:[],dislikes:[]}; return {likes:L.likes.length, dislikes:L.dislikes.length} },
  async toggleLike(vid, uid){ const likes = DB.read('likes',{}); likes[vid] ??= {likes:[],dislikes:[]}; const L=likes[vid]; if(!L.likes.includes(uid)) L.likes.push(uid); L.dislikes=L.dislikes.filter(x=>x!==uid); await DB.write('likes',likes) },
  async toggleDislike(vid, uid){ const likes = DB.read('likes',{}); likes[vid] ??= {likes:[],dislikes:[]}; const L=likes[vid]; if(!L.dislikes.includes(uid)) L.dislikes.push(uid); L.likes=L.likes.filter(x=>x!==uid); await DB.write('likes',likes) },
  views(id){ return DB.read('views',{})[id] || 0 },
  async addView(id){ const views=DB.read('views',{}); views[id]=(views[id]||0)+1; await DB.write('views',views) },
  subs(){ return DB.read('subs',{}) },
  subCount(chId){ const s=DB.read('subs',{}); return Object.values(s).reduce((acc,list)=> acc + (Array.isArray(list) && list.includes(chId) ? 1 : 0), 0) },
  isSubbed(chId, uid){ const s=DB.read('subs',{}); return Array.isArray(s?.[uid]) && s[uid].includes(chId) },

  async toggleSub(ch, uid){ const s=DB.read('subs',{}); s[uid] ??= []; if(s[uid].includes(ch)) s[uid]=s[uid].filter(x=>x!==ch); else s[uid].push(ch); await DB.write('subs',s) }
};

function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36) }
function timeAgo(ts){ const d=Date.now()-ts; const m=Math.floor(d/60000); if(m<60) return `il y a ${m} min`; const h=Math.floor(m/60); if(h<24) return `il y a ${h} h`; const g=Math.floor(h/24); if(g<30) return `il y a ${g} jours`; const mo=Math.floor(g/30); if(mo<12) return `il y a ${mo} mois`; const y=Math.floor(mo/12); return `il y a ${y} an${y>1?'s':''}` }
function getYouTubeId(url){ if(!url) return null; const r=/(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|watch\?v=|v\/))([A-Za-z0-9_-]{6,})/; const m=url.match(r); return m?m[1]:null }
function escapeHtml(s){ return s?.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[m]) || "" }
function formatNumber(n){ if(n>=1_000_000) return (n/1_000_000).toFixed(1).replace('.0','')+' M'; if(n>=1_000) return (n/1_000).toFixed(1).replace('.0','')+' k'; return n.toString() }
function linkify(t){ const url=/((https?:\/\/|www\.)[^\s]+)/g; return t.replace(url, u=>`<a href="${u.startsWith('http')?u:'https://'+u}" target="_blank" rel="noopener">${u}</a>`); }
const $app = ()=>$("#app");


function userAvatar(u){ return avatarSrcOrInitial(u) }
function getUser(id){ return DB.read('users',[]).find(u=>u.id===id) || null }

/* UI Topbar */
function renderTopbar(){
  const right=$("#topbarRight"); right.innerHTML="";
  if(State.me){
    right.append(btnIcon("upload","Poster",openPostModal), btnIcon("video_library","Mes vidéos",()=>navigate('#/myvideos')), btnIcon("notifications","Notifications",openNotifMenu));
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

  // Click handlers for menu items
  box.querySelector('#mi-videos').onclick=()=>navigate('#/myvideos');
  box.querySelector('#mi-edit-profile').onclick=()=>navigate('#/profile/edit');
  box.querySelector('#mi-my-channel').onclick=()=>navigate(`#/channel/${State.me.handle||State.me.id}`);
  box.querySelector('#mi-logout').onclick=()=>{ State.me=null; renderTopbar(); route(); box.remove(); };

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
  $("#mi-videos").onclick = ()=>{ navigate('#/myvideos'); box.remove(); };
  $("#mi-edit-profile").onclick = ()=>{ navigate('#/profile/edit'); box.remove(); };
  $("#mi-my-channel").onclick = ()=>{ navigate(`#/channel/${State.me.handle||State.me.id}`); box.remove(); };
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
  <header><strong>${isLogin?'Connexion':'Créer un compte'}</strong><button class="icon-button" onclick="this.closest('dialog').close()"><span class="material-symbols-rounded">close</span></div></header>
  <div class="body">
    ${isLogin?`
      <form id="loginForm" class="gridform">
        <input name="pseudo" placeholder="Pseudo" required>
        <input name="password" placeholder="Mot de passe" type="password" required>
        <div></div><button class="btn primary">Se connecter</div>
      </form>`:`
      <form id="registerForm" class="gridform">
        <input name="nom" placeholder="Nom" required>
        <input name="prenom" placeholder="Prénom" required>
        <input name="pseudo" placeholder="Pseudo" required>
        <input name="tel" placeholder="Numéro de téléphone" required>
        <input name="iban" placeholder="Numéro de compte en banque (optionnel)">
        <input name="photo" placeholder="Lien photo de profil (optionnel)">
        <input name="header" placeholder="Lien du header (optionnel)">
        <input name="password" placeholder="Mot de passe" type="password" required>
        <div></div><button class="btn primary">Créer le compte</div>
      </form>`}
  </div>`;
  if(isLogin){
    $("#loginForm", dlg).onsubmit = (e)=>{
      e.preventDefault(); const pseudo=e.target.pseudo.value.trim(); const pass=e.target.password.value;
      const u = State.users().find(x=>x.pseudo===pseudo && x.password===pass);
      if(u){ State.me=u; renderTopbar(); dlg.close(); route(); } else alert("Identifiants invalides.");
    }
  }else{
    $("#registerForm", dlg).onsubmit = async (e)=>{
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const u = { id: uid(), ...fd, createdAt: Date.now() };
      await State.saveUser(u); State.me=u; renderTopbar(); dlg.close(); route();
    }
  }
  dlg.showModal();
}

function openPostModal(){
  if(!State.me) return openAuthModal('login');
  const dlg=$("#postModal");
  dlg.innerHTML = `
  <header><strong>Poster une vidéo</strong><button class="icon-button" onclick="this.closest('dialog').close()"><span class="material-symbols-rounded">close</span></div></header>
  <div class="body">
    <form id="postForm" class="gridform">
      <input name="title" placeholder="Nom de la vidéo (optionnel)">
      <select name="category" required>
        <option value="Video">Video</option><option value="Short">Short</option><option value="News">News</option><option value="Fiction">Fiction</option><option value="Musique">Musique</option>
      </select>
      <input name="thumb" placeholder="Lien de la miniature (optionnel)">
      <input name="tags" placeholder="Tags séparés par des virgules (optionnel)">
      <input name="url" placeholder="Lien YouTube ou lien vidéo direct" required>
      <textarea name="desc" placeholder="Description" required></textarea>
      <div></div><button class="btn primary">Publier</div>
    </form>
  </div>`;
  $("#postForm", dlg).onsubmit = async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const ytId = getYouTubeId(fd.url); let thumb = fd.thumb?.trim();
    if(!thumb || thumb.length<6){ thumb = ytId?`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`:'assets/placeholder.svg'; }
    const video = { id:uid(), title: fd.title?.trim()||'Sans titre', description: fd.desc, url: fd.url.trim(), thumb, category: fd.category, tags: fd.tags?fd.tags.split(',').map(t=>t.trim()).filter(Boolean):[], channelId: State.me.id, createdAt: Date.now() };
    await State.saveVideo(video); dlg.close(); navigate(`#/video/${video.id}`);
  }
  dlg.showModal();
}

function openNotifModal(){
  const dlg=$("#notifModal"); const me=State.me; const notes = DB.read('notifications',{}); const list = me?(notes[me.id]||[]):[];
  dlg.innerHTML = `<header><strong>Notifications</strong><button class="icon-button" onclick="this.closest('dialog').close()"><span class="material-symbols-rounded">close</span></div></header>
  <div class="body">${list.length?list.map(n=>`<div class="chip">${n}</div>`).join(''):'Aucune notification'}</div>`;
  dlg.showModal();
}



function openNotifMenu(){
  if(!State.me) return openAuthModal('login');
  // remove any existing flyouts
  const old = document.querySelector('.notif-flyout'); if(old) old.remove();
  const oldMenu = document.querySelector('.menu-flyout'); if(oldMenu) oldMenu.remove();

  const me = State.me;
  const box = document.createElement('div');
  box.className = 'notif-flyout';
  box.innerHTML = `<header>Notifications</header><div class="notif-list" id="notifList"></div>`;
  document.body.appendChild(box);

  // Click handlers for menu items
  box.querySelector('#mi-videos').onclick=()=>navigate('#/myvideos');
  box.querySelector('#mi-edit-profile').onclick=()=>navigate('#/profile/edit');
  box.querySelector('#mi-my-channel').onclick=()=>navigate(`#/channel/${State.me.handle||State.me.id}`);
  box.querySelector('#mi-logout').onclick=()=>{ State.me=null; renderTopbar(); route(); box.remove(); };

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
  videos.filter(v=>mySubs.includes(v.channelId)).forEach(v=>{
    const ch = byUser(v.channelId);
    items.push({
      ts: v.createdAt || 0,
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
    list.innerHTML = items.slice(0,60).map(it=>`
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
function navigate(hash){ location.hash = hash }
window.addEventListener('hashchange', route);
$("#menuBtn").onclick = ()=> $("#sidebar").classList.toggle("open");
$("#searchForm").onsubmit = (e)=>{ e.preventDefault(); const q=$("#searchInput").value.trim(); navigate(q?`#/search/${encodeURIComponent(q)}`:'#/') }

async function route(){
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
  if(!page) return viewHome();
  switch(page){
    case 'trending': return viewTrending();
    case 'subs': return viewSubs();
    case 'category': return viewCategory(decodeURIComponent(p2));
    case 'video': return viewVideo(p2);
    case 'channel': return viewChannel(p2);
    case 'profile': if(p2==='edit') return viewEditProfile();
    case 'search': return viewSearch(decodeURIComponent(p2));
    case 'myvideos': return viewMyVideos();
    default: return viewHome();
  }
}

/* Views */
function videoGrid(videos, title){
  const app=$app(); app.innerHTML="";
  const h=document.createElement('div'); h.innerHTML=`<div class="section-title">${title}</div>`; app.appendChild(h);
  const grid=document.createElement('div'); grid.className="grid"; app.appendChild(grid);
  if(!videos.length){ grid.outerHTML=`<div class="feed-empty">Rien à afficher.</div>`; return }
  videos.forEach(v=> grid.appendChild(videoCard(v)));
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
  const desc = (v.description || '').toString().trim();
  if(desc) tpl.querySelector('.desc').textContent = desc;
  const tagsWrap = tpl.querySelector('.tags');
  (v.tags||[]).slice(0,6).forEach(t=>{
    const badge=document.createElement('span'); badge.className='chip'; badge.textContent = t;
    tagsWrap.appendChild(badge);
  });
  const root = tpl.firstElementChild; makeClickable(root, `#/video/${v.id}`); return tpl;
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
  return tpl;
}
function viewHome(){ const vids = DB.read('videos',[]).slice().sort((a,b)=>b.createdAt-a.createdAt); videoGrid(vids,"Dernières vidéos") }
function viewTrending(){ const vids = DB.read('videos',[]).slice().sort((a,b)=> (State.views(b.id)+2*State.likeStats(b.id).likes) - (State.views(a.id)+2*State.likeStats(a.id).likes)); videoGrid(vids,"Tendances") }
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
          <div class="inline-actions">
            <div class="badge" id="likeBtn"><span class="material-symbols-rounded">thumb_up</span> J'aime (<span id="likeCount">0</span>)</div>
            <div class="badge" id="dislikeBtn"><span class="material-symbols-rounded">thumb_down</span> Je n'aime pas</div>
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
  </div>`; return } const subIds=DB.read('subs',{})[me.id]||[]; const vids=DB.read('videos',[]).filter(v=>subIds.includes(v.channelId)).sort((a,b)=>b.createdAt-a.createdAt); videoGrid(vids,"Abonnements") }
function viewCategory(cat){ const vids=DB.read('videos',[]).filter(v=>v.category===cat).sort((a,b)=>b.createdAt-a.createdAt); videoGrid(vids,cat) }



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
  const vids = DB.read('videos',[]).filter(v => {
    const t = (v.title||"").toLowerCase();
    const tags = (v.tags||[]).join(" ").toLowerCase();
    return t.includes(needle) || tags.includes(needle);
  });
  const sec2 = document.createElement('div');
  const head = document.createElement('div'); head.className='section-title'; head.textContent='Vidéos';
  const list = document.createElement('div'); list.className='result-list';
  vids.forEach(v => list.appendChild(videoRow(v)));
  sec2.appendChild(head); sec2.appendChild(list); app.appendChild(sec2);
  if(!vids.length){ list.outerHTML = `<div class="feed-empty">Rien à afficher.</div>`; }
}

function viewVideo(id){
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
    <div class="inline-actions">
      <div class="badge" id="likeBtn"><span class="material-symbols-rounded">thumb_up</span> J'aime (<span id="likeCount">0</span>)</div>
      <div class="badge" id="dislikeBtn"><span class="material-symbols-rounded">thumb_down</span> Je n'aime pas</div>
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
  player.innerHTML = yt?`<iframe src="https://www.youtube.com/embed/${yt}" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`:`<video controls src="${v.url}" poster="${v.thumb}"></video>`;
  let viewed=false; player.addEventListener('click', async ()=>{ if(!viewed){ viewed=true; await State.addView(v.id); route(); } }, {once:true});
  const stats = State.likeStats(v.id); $("#likeCount").textContent=stats.likes;
  const vhAv = $(".vh-avatar"); if(vhAv){ vhAv.replaceWith(makeAvatarElement(ch, 40)); }
  const vhimg = document.querySelector('.video-header .vh-left img'); if(vhimg) vhimg.src = avatarSrcOrInitial(ch);
  $("#likeBtn").onclick = async ()=>{ if(!State.me) return openAuthModal('login'); await State.toggleLike(v.id, State.me.id); route(); }
  $("#dislikeBtn").onclick = async ()=>{ if(!State.me) return openAuthModal('login'); await State.toggleDislike(v.id, State.me.id); route(); }
  $("#shareBtn").onclick = async ()=>{ await navigator.clipboard.writeText(v.url); alert("URL de la vidéo copiée"); }
  $("#subBtn").onclick = async ()=>{ if(!State.me) return openAuthModal('login'); await State.toggleSub(ch.id, State.me.id); route(); }
const showDesc = ()=> {
    const tags = v.tags.map(t=>`<span class="chip">#${escapeHtml(t)}</span>`).join(' ');
    const meta = `<div class="desc-meta"><strong>${formatNumber(State.views(v.id))} vues</strong> • ${timeAgo(v.createdAt)} ${tags?`• ${tags}`:''}</div>`;
    $("#tabContent").innerHTML = `${meta}<p>${linkify(escapeHtml(v.description)).replaceAll('\n','<br>')}</p>`;
  };
  const showCom = ()=> renderComments(v.id);
  $("#tabDesc").onclick=(e)=>{ $$(".tabs button").forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); showDesc(); };
  $("#tabCom").onclick=(e)=>{ $$(".tabs button").forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); showCom(); };
  showDesc();
}

function renderComments(videoId){
  const box=$("#tabContent"); const list=DB.read('comments',[]).filter(c=>c.videoId===videoId).sort((a,b)=>a.createdAt-b.createdAt);
  box.innerHTML = `${State.me?`
    <form id="commentForm" style="display:flex;gap:8px;margin-bottom:8px">
      <input name="text" placeholder="Ajouter un commentaire..." style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);background:#111;color:#fff">
      <button class="btn primary">Envoyer</div>
    </form>`:`<div class="feed-empty">Connectez-vous pour commenter.</div>`}
    <div id="commentsList"></div>`;
  const listBox=$("#commentsList");
  if(list.length===0) listBox.innerHTML=`<div class="feed-empty">Aucun commentaire.</div>`;
  list.forEach(c=>{ const u=getUser(c.userId); const el=document.createElement('div'); el.style.padding='8px 0'; el.innerHTML=`<div class="channel-line"><img src="${u?.photo||'assets/placeholder.svg'}"><strong>${u?.pseudo||'Utilisateur'}</strong> <span class="statline"> • ${timeAgo(c.createdAt)}</span></div><div style="margin-left:46px">${escapeHtml(c.text)}</div>`; listBox.appendChild(el); });
  const form=$("#commentForm"); if(form){ form.onsubmit = async (e)=>{ e.preventDefault(); const text=new FormData(form).get('text')?.toString().trim(); if(!text) return; await State.saveComment({id:uid(), videoId, userId:State.me.id, text, createdAt:Date.now()}); // notify owner
      const v=DB.read('videos',[]).find(v=>v.id===videoId); const notes = DB.read('notifications',{}); notes[v.channelId] ??= []; notes[v.channelId].push(`Nouveau commentaire sur "${v.title}" par ${State.me.pseudo}`); await DB.write('notifications', notes); renderComments(videoId); } }
}

function viewChannel(userId){
  const u=getUser(userId); if(!u){ $app().innerHTML="<div class='feed-empty'>Chaîne introuvable.</div>"; return }
  const header=u.header || "https://i.ytimg.com/vi/9bZkp7q19f0/maxresdefault.jpg";
  const vids=DB.read('videos',[]).filter(v=>v.channelId===userId).sort((a,b)=>b.createdAt-a.createdAt);
  $app().innerHTML = `
    <div class="card" style="overflow:hidden">
      <div style="height:200px;background:url('${header}') center/cover no-repeat"></div>
      <div style="display:flex;gap:12px;align-items:center;padding:12px">
        <img src="${u.photo || avatarSrcOrInitial(u)}" onerror="this.onerror=null;this.src=avatarSrcOrInitial(u)" style="width:80px;height:80px;border-radius:50%;object-fit:cover;background:#111">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="title-xl" style="margin:0;padding:0">${u.pseudo}</div>
          <div class="statline">• ${formatNumber(State.subCount(u.id))} abonnés • ${DB.read('videos',[]).filter(x=>x.channelId===u.id).length} vidéos</div>
          <div class="statline">${(u.description||u.bio||u.about||"").trim() || ""}</div>\n          <div class="statline">${(u.bio||u.description||'').trim() ? escapeHtml((u.bio||u.description||'').trim()) : ''}</div>
        </div>
        <div style="margin-left:auto">${State.me && State.me.id!==u.id?`<div class="badge" id="subBtn">${State.isSubbed(u.id, State.me?.id)?"Se désabonner":"S'abonner"}</div>`:''}</div>
      </div>
    </div>
    <div class="section-title">Vidéos</div>
    <div class="grid" id="grid"></div>`;
  const grid=$("#grid"); if(!vids.length) grid.outerHTML=`<div class="feed-empty">Aucune vidéo.</div>`; else vids.forEach(v=>grid.appendChild(videoCard(v)));
  const chAv = $(".channel-avatar"); if(chAv){ chAv.replaceWith(makeAvatarElement(u, 80)); }
  const subBtn=$("#subBtn"); if(subBtn){ subBtn.onclick=async ()=>{ if(!State.me) return openAuthModal("login"); await State.toggleSub(u.id, State.me.id); route(); } }
}

function getUser(id){ return DB.read('users',[]).find(u=>u.id===id) }


/* === New Views === */
function viewMyVideos(){
  const root=$("#root"); const me=State.me; if(!me) return openAuthModal('login');
  const vids = DB.videos().filter(v=>v.authorId===me.id);
  root.innerHTML = `<div class="container">
    <div class="title-xl">Mes vidéos</div>\n          <div class="statline">${(u.bio||u.description||'').trim() ? escapeHtml((u.bio||u.description||'').trim()) : ''}</div>
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

function openEditVideo(v){
  const title = prompt("Nouveau titre", v.title||"");
  if(title===null) return;
  const desc = prompt("Description", v.desc||"");
  if(desc===null) return;
  const thumb = prompt("URL miniature", v.thumb||"");
  const tags = prompt("Tags (séparés par des virgules)", (v.tags||[]).join(','));
  v.title=title; v.desc=desc; v.thumb=thumb; v.tags=(tags||'').split(',').map(s=>s.trim()).filter(Boolean);
  DB.saveVideo(v).then(()=>route());
}

function viewEditProfile(){
  const root=$("#root"); const me=State.me; if(!me) return openAuthModal('login');
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
    DB.saveUser(me).then(()=>{ alert("Profil mis à jour"); route(); });
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
DB.init().then(()=> route());

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
  const preview = $("#editThumbPreview", dlg);
  form.thumb.addEventListener('input', ()=>{ preview.src = form.thumb.value || 'assets/placeholder.svg'; });
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const tags = (fd.tags||'').split(',').map(s=>s.trim()).filter(Boolean);
    const updated = Object.assign({}, v, { title: fd.title?.trim()||'Sans titre', thumb: (fd.thumb||'').trim(), tags });
    await State.saveVideo(updated);
    dlg.close();
    viewMyVideos();
  };
  $("#deleteVideoBtn", dlg).onclick = async ()=>{
    if(!confirm("Supprimer définitivement cette vidéo ?")) return;
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
      <label>Mot de passe<input name="password" type="password" value="${escapeAttribute(me.password||'')}" ></label>
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
    alert("Profil mis à jour.");
    navigate(`#/channel/${updated.handle||updated.id}`);
  };

  $("#pe-delete", wrap).onclick = async ()=>{
    if(!confirm("Supprimer définitivement votre chaîne ? Toutes vos vidéos, commentaires et likes seront supprimés.")) return;
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
    alert("Chaîne supprimée.");
  };
}
