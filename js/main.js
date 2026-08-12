(function () {
  'use strict';

  /* ---------- tweakable constants (were DC editor props) ---------- */
  var PIXEL_SCALE = 1;        // 1 = full internal resolution (crisp PS2/PS3-era look)
  var ENABLE_JITTER = false;  // PS1 vertex wobble, off for the realistic look
  var START_MUTED = true;     // site starts muted; user opts in via the SOUND button

  var els = {
    stage: document.getElementById('stage'),
    canvas: document.getElementById('scene'),
    hint: document.getElementById('hint'),
    muteBtn: document.getElementById('muteBtn'),
    overlay: document.getElementById('overlay'),
    desktop: document.getElementById('desktop'),
    deskIcons: document.getElementById('deskIcons'),
    windows: document.getElementById('windows'),
    taskbarTabs: document.getElementById('taskbarTabs'),
    trayClock: document.getElementById('trayClock'),
    startBtn: document.getElementById('startBtn'),
    startFlag: document.getElementById('startFlag'),
    fx: document.getElementById('fxCanvas'),
    backBtn: document.getElementById('backBtn'),
    dialogue: document.getElementById('dialogue'),
    dialogueBox: document.getElementById('dialogueBox'),
    dialogueLine: document.getElementById('dialogueLine'),
    introModal: document.getElementById('introModal'),
    introMsg: document.querySelector('#introDialog .dlg-msg'),
    introBtns: document.querySelector('#introDialog .dlg-btns'),
  };

  var App = {
    view: 'desk',
    mx: 0, my: 0,
    tween: null,
    booted: false,
    winCount: 0,
    zTop: 40,
    muted: START_MUTED,
    _dead: false,
    introActive: false,
    introIndex: 0,
    introMessages: [
      'welcome to my room...',
      "please don't touch anything on my desk...",
      "and also please don't smoke in here!",
    ],
    // desktop intro quiz (Win95 error-dialog style); must be completed to use the desktop
    quizTree: {
      q1: { msg: 'Are you friends with sam?', buttons: [{ label: 'Yes', go: 'yes' }, { label: 'No', go: 'no' }] },
      yes: { msg: "Thats so FIREEE! I wish I could be friends with him but I'm just a machine!", buttons: [{ label: 'Ok', go: 'DONE' }] },
      no: { msg: 'Rough...You do be missing out!\nWhy do you think you are no friends?', buttons: [{ label: "I'm a loser", go: 'imloser' }, { label: 'He is a loser', go: 'wrong' }] },
      imloser: { msg: 'Thats what I thought...', buttons: [{ label: 'Ok', go: 'DONE' }] },
      wrong: { msg: 'Wrong answer\nError.', buttons: [{ label: 'Ok', go: 'no' }] },
    },

    /* ---------- AUDIO ---------- */
    initAudio: function () {
      if (this.actx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var A = new AC(); this.actx = A;
      var m = A.createGain(); m.gain.value = this.muted ? 0 : 0.5; m.connect(A.destination); this.master = m;
      var hum = A.createOscillator(); hum.type = 'sine'; hum.frequency.value = 60;
      var hg = A.createGain(); hg.gain.value = 0.05; hum.connect(hg).connect(m); hum.start();
      var wh = A.createOscillator(); wh.type = 'sine'; wh.frequency.value = 15600;
      var wg = A.createGain(); wg.gain.value = 0.006; wh.connect(wg).connect(m); wh.start();
      var buf = A.createBuffer(1, A.sampleRate * 2, A.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var ns = A.createBufferSource(); ns.buffer = buf; ns.loop = true;
      var nf = A.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 7000;
      var ng = A.createGain(); ng.gain.value = 0.006;
      ns.connect(nf).connect(ng).connect(m); ns.start();
    },
    blip: function (f, dur, type) {
      if (!this.actx || this.muted) return;
      var A = this.actx, o = A.createOscillator(), g = A.createGain();
      o.type = type || 'square'; o.frequency.value = f; o.connect(g).connect(this.master);
      var t = A.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.07));
      o.start(t); o.stop(t + (dur || 0.07) + 0.02);
    },
    click: function () { this.blip(1300, 0.04, 'square'); },
    beep: function () { this.blip(720, 0.11, 'square'); },
    playBeerSound: function () {
      if (this.muted) return;
      if (!this._beerSnd) {
        this._beerSnd = new Audio(window.BEER_AUDIO || './assets/beer-drink.mp3');
        this._beerSnd.preload = 'auto';
        this._beerSnd.volume = 0.9;
      }
      try {
        this._beerSnd.pause();
        this._beerSnd.currentTime = 0;
        var p = this._beerSnd.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    },
    toggleMute: function () {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
      els.muteBtn.textContent = 'SOUND: ' + (this.muted ? 'OFF' : 'ON');
    },

    /* ---------- SCENE ---------- */
    init: function () {
      if (this._inited) return; this._inited = true;
      var self = this;
      var T = window.THREE, canvas = els.canvas, stage = els.stage;
      var PIX = Math.max(1, Math.round(PIXEL_SCALE));
      var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x100f0d, 1);
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      var scene = new T.Scene(); scene.fog = new T.Fog(0x17140f, 5.5, 12);
      var cam = new T.PerspectiveCamera(46, 1, 0.05, 100);
      this.scene = scene; this.cam = cam; this.renderer = renderer; this.ray = new T.Raycaster();
      this.BASE = new T.Vector3(-0.64, 1.64, 1.92); this.LOOK = new T.Vector3(0.05, 0.98, -0.42);
      this.IN_POS = new T.Vector3(-0.18, 1.21, 0.30); this.SCREEN_CTR = new T.Vector3(-0.18, 1.21, -0.04);
      cam.position.copy(this.BASE); cam.lookAt(this.LOOK);

      els.overlay.style.display = 'none';
      els.overlay.style.pointerEvents = 'none';

      var size = function () {
        var w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
        renderer.setSize(Math.max(1, Math.floor(w / PIX)), Math.max(1, Math.floor(h / PIX)), false);
        cam.aspect = w / h; cam.updateProjectionMatrix();
      };
      size(); this._onResize = size; window.addEventListener('resize', size);

      /* PS1 vertex jitter */
      var jitter = ENABLE_JITTER;
      var ps1 = function (m) {
        if (jitter) {
          m.onBeforeCompile = function (sh) {
            sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>',
              '#include <project_vertex>\n vec4 _p=gl_Position; _p.xyz/=_p.w; _p.x=floor(_p.x*260.0)/260.0; _p.y=floor(_p.y*210.0)/210.0; _p.xyz*=_p.w; gl_Position=_p;');
          };
        }
        return m;
      };

      /* texture helper */
      var ctex = function (w, h, draw, nearest) {
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'); g.imageSmoothingEnabled = !nearest; draw(g, w, h);
        var t = new T.CanvasTexture(c);
        var f = nearest ? T.NearestFilter : T.LinearFilter;
        t.magFilter = f; t.minFilter = f; t.generateMipmaps = false; t.encoding = T.sRGBEncoding;
        try { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
        return t;
      };

      /* grungy dither overlay for the PS2-era low-res prop textures */
      var grunge = function (g, w, h, amt) {
        amt = amt || 0.14;
        var n = (w * h * 0.55) | 0;
        for (var i = 0; i < n; i++) {
          var x = (Math.random() * w) | 0, y = (Math.random() * h) | 0;
          g.fillStyle = Math.random() < 0.5
            ? 'rgba(0,0,0,' + (amt * Math.random()).toFixed(3) + ')'
            : 'rgba(255,255,255,' + (amt * 0.6 * Math.random()).toFixed(3) + ')';
          g.fillRect(x, y, 1, 1);
        }
      };

      var deskTex = ctex(256, 256, function (g, w, h) {
        g.fillStyle = '#8d8b85'; g.fillRect(0, 0, w, h);
        for (var i = 0; i < 70; i++) {
          g.fillStyle = 'rgba(70,67,62,' + (0.04 + Math.random() * 0.08) + ')';
          var x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 22;
          g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        }
        for (var i2 = 0; i2 < 16000; i2++) {
          var v = Math.random();
          g.fillStyle = v < .34 ? 'rgba(58,56,52,.30)' : v < .67 ? 'rgba(120,116,108,.30)' : 'rgba(205,202,194,.28)';
          g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1, 1);
        }
      });
      var wallTex = ctex(256, 256, function (g, w, h) {
        g.fillStyle = '#43464b'; g.fillRect(0, 0, w, h);
        for (var i = 0; i < 90; i++) {
          g.fillStyle = 'rgba(0,0,0,' + (0.03 + Math.random() * 0.07) + ')';
          g.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 46, 4 + Math.random() * 46);
        }
        for (var i2 = 0; i2 < 70; i2++) {
          g.fillStyle = 'rgba(210,214,220,' + (0.02 + Math.random() * 0.04) + ')';
          g.fillRect(Math.random() * w, Math.random() * h, 2, 10 + Math.random() * 40);
        }
        for (var i3 = 0; i3 < 9000; i3++) {
          g.fillStyle = Math.random() < .5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.04)';
          g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1, 1);
        }
      });
      var screenTex = ctex(160, 120, function (g, w, h) {
        var sky = g.createLinearGradient(0, 0, 0, 88);
        sky.addColorStop(0, '#2f6fc9'); sky.addColorStop(0.55, '#5fa3e6'); sky.addColorStop(1, '#bfe0f5');
        g.fillStyle = sky; g.fillRect(0, 0, w, 88);
        var glow = g.createRadialGradient(36, 20, 2, 36, 20, 46);
        glow.addColorStop(0, 'rgba(255,255,240,.55)'); glow.addColorStop(1, 'rgba(255,255,240,0)');
        g.fillStyle = glow; g.fillRect(0, 0, w, 88);
        var cloud = function (cx, cy, s) {
          g.fillStyle = 'rgba(255,255,255,.92)';
          [[0, 0, 1], [0.8, 0.15, 0.7], [-0.9, 0.1, 0.65], [0.3, -0.3, 0.6], [-0.4, -0.25, 0.55]].forEach(function (o) {
            g.beginPath(); g.arc(cx + o[0] * s, cy + o[1] * s, s * o[2] * 0.6 + s * 0.35, 0, 7); g.fill();
          });
          g.fillStyle = 'rgba(170,195,215,.35)';
          g.beginPath(); g.arc(cx, cy + s * 0.32, s * 0.9, 0, Math.PI); g.fill();
        };
        cloud(30, 18, 9); cloud(96, 12, 6); cloud(126, 26, 7); cloud(60, 8, 4);
        g.beginPath();
        g.moveTo(0, 96);
        g.quadraticCurveTo(30, 74, 66, 84);
        g.quadraticCurveTo(104, 96, 160, 80);
        g.lineTo(160, 120); g.lineTo(0, 120); g.closePath();
        var grass = g.createLinearGradient(0, 80, 0, 120);
        grass.addColorStop(0, '#8fc24a'); grass.addColorStop(0.4, '#5c9a35'); grass.addColorStop(1, '#356b1e');
        g.fillStyle = grass; g.fill();
        g.strokeStyle = 'rgba(210,240,150,.5)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, 96); g.quadraticCurveTo(30, 74, 66, 84); g.quadraticCurveTo(104, 96, 160, 80); g.stroke();
        for (var y = 0; y < 120; y += 2) { g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, y, 160, 1); }
      }, true);
      var ventTex = ctex(96, 160, function (g, w, h) {
        g.fillStyle = '#cec5ab'; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, w, 10);
        var top = 22, bottom = h - 14, n = 13, gap = (bottom - top) / n;
        for (var i = 0; i < n; i++) {
          var vy = top + i * gap;
          g.fillStyle = 'rgba(30,28,24,.55)'; g.fillRect(10, vy, w - 20, gap * 0.42);
          g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(10, vy + gap * 0.42, w - 20, 1.5);
        }
      });
      var bezelLabelTex = ctex(440, 360, function (g, w, h) {
        g.fillStyle = '#d9d0b8'; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, 0, w, 10);
        g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, h - 8, w, 8);
        g.fillStyle = '#7a715c'; g.font = 'bold 15px sans-serif'; g.fillText('NONAME', 20, h - 26);
        g.fillStyle = '#3a382f'; g.beginPath(); g.arc(w - 34, h - 30, 11, 0, 7); g.fill();
        g.strokeStyle = '#8f8770'; g.lineWidth = 1.5; g.beginPath(); g.arc(w - 34, h - 30, 6, 0.9 * Math.PI, 2.6 * Math.PI); g.stroke();
        g.fillStyle = '#5fe06a'; g.beginPath(); g.arc(w - 62, h - 30, 3.2, 0, 7); g.fill();
      });
      var towerTex = ctex(256, 512, function (g, w, h) {
        var grd = g.createLinearGradient(0, 0, w, 0);
        grd.addColorStop(0, '#dbd2b9'); grd.addColorStop(.5, '#cec5ab'); grd.addColorStop(1, '#bbb298');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 3, w, 2);
        var bay = function (y) {
          g.fillStyle = '#c5bca2'; g.fillRect(28, y, 200, 46);
          g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 2; g.strokeRect(28, y, 200, 46);
          g.fillStyle = '#1b1b1d'; g.fillRect(40, y + 14, 150, 18);
          g.fillStyle = '#d6cdb3'; g.fillRect(196, y + 16, 20, 14); g.strokeRect(196, y + 16, 20, 14);
        };
        bay(42); bay(98);
        g.fillStyle = '#bcb399'; g.fillRect(28, 158, 200, 30);
        g.strokeStyle = 'rgba(0,0,0,.24)'; g.strokeRect(28, 158, 200, 30);
        g.fillStyle = '#28282a'; g.fillRect(40, 169, 150, 7);
        g.fillStyle = '#6f6f71'; g.fillRect(198, 166, 16, 12);
        g.fillStyle = '#211f1b'; g.fillRect(28, 212, 200, 72);
        g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeRect(28, 212, 200, 72);
        g.fillStyle = '#8f8979'; g.fillRect(46, 230, 46, 18);
        g.fillStyle = '#b6af9b'; g.fillRect(46, 230, 46, 3);
        g.fillStyle = '#8f8979'; g.fillRect(100, 230, 26, 18);
        g.fillStyle = '#62e06c'; g.fillRect(150, 228, 12, 7);
        g.fillStyle = '#e0573f'; g.fillRect(150, 243, 12, 7);
        g.fillStyle = '#3a3a3c'; g.fillRect(176, 226, 36, 12); g.fillRect(176, 244, 36, 10);
        g.fillStyle = '#c5bca2'; g.beginPath(); g.arc(128, 338, 27, 0, 7); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#79a4c6'; g.fillRect(121, 326, 14, 14);
        g.fillStyle = 'rgba(0,0,0,.16)'; for (var i = 0; i < 11; i++) g.fillRect(40, 402 + i * 9, 176, 4);
        g.fillStyle = 'rgba(46,44,40,.5)'; g.font = 'bold 17px monospace'; g.fillText('NONAME', 76, 492);
      });
      var keyTex = ctex(512, 224, function (g, w, h) {
        g.fillStyle = '#cabfa6'; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 5, w, 2);
        var key = function (x, y, kw, kh) {
          g.fillStyle = '#a79d83'; g.fillRect(x, y, kw, kh);
          g.fillStyle = '#d9cfb7'; g.fillRect(x + 1, y + 1, kw - 2, kh - 3);
          g.fillStyle = '#efe7d2'; g.fillRect(x + 1, y + 1, kw - 2, Math.max(2, (kh - 3) * 0.32));
        };
        var x = 12;
        for (var i = 0; i < 12; i++) { key(x, 12, 30, 16); x += 34; if (i === 0 || i === 4 || i === 8) x += 8; }
        var y = 42;
        for (var r = 0; r < 4; r++) {
          var cx = 12; var n = 15 - r; var gap = 5; var kw = (w - 24 - (n - 1) * gap) / n;
          for (var c = 0; c < n; c++) { key(cx, y, kw, 32); cx += kw + gap; }
          y += 38;
        }
        key(12, y, 60, 30); key(78, y, 44, 30); key(168, y, 184, 30); key(358, y, 44, 30); key(408, y, 92, 30);
      });
      // low-res, dithered beer-can wrap (silver body, gold bands, crest — no logo)
      // blue "Appenzeller"-style beer can wrap to match the reference artwork
      var beerTex = ctex(128, 200, function (g, w, h) {
        g.fillStyle = '#2f74bd'; g.fillRect(0, 0, w, h);
        // top dark-blue band: BEER | swiss cross | THE ORIGINAL
        g.fillStyle = '#1f5fa6'; g.fillRect(0, 0, w, h * 0.185);
        g.fillStyle = '#0e4a8c'; g.fillRect(0, h * 0.185 - 2, w, 2);
        g.fillStyle = '#eaf1f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'bold 13px sans-serif';
        g.fillText('BEER', w * 0.2, h * 0.093);
        g.font = 'bold 10px sans-serif';
        g.fillText('THE ORIGINAL', w * 0.76, h * 0.093);
        g.fillStyle = '#d21f2b'; g.beginPath(); g.arc(w * 0.5, h * 0.093, h * 0.05, 0, 7); g.fill();
        g.fillStyle = '#fff';
        g.fillRect(w * 0.5 - 2, h * 0.093 - 6, 4, 12); g.fillRect(w * 0.5 - 6, h * 0.093 - 2, 12, 4);
        // pale blue upper body
        g.fillStyle = '#cfe0ee'; g.fillRect(0, h * 0.185, w, h * 0.17);
        // ---- alpine landscape panel ----
        var lx = w * 0.1, lw = w * 0.8, ly = h * 0.35, lh = h * 0.46;
        g.fillStyle = '#d7ebf3'; g.fillRect(lx, ly, lw, lh);                 // sky
        g.fillStyle = '#8aa0b2'; g.beginPath();                              // mountains
        g.moveTo(lx, ly + lh * 0.42);
        g.lineTo(lx + lw * 0.22, ly + lh * 0.10); g.lineTo(lx + lw * 0.4, ly + lh * 0.34);
        g.lineTo(lx + lw * 0.62, ly + lh * 0.07); g.lineTo(lx + lw * 0.82, ly + lh * 0.30);
        g.lineTo(lx + lw, ly + lh * 0.16); g.lineTo(lx + lw, ly + lh * 0.44); g.lineTo(lx, ly + lh * 0.44);
        g.closePath(); g.fill();
        g.fillStyle = '#eef5f9';                                            // snow caps
        g.beginPath(); g.moveTo(lx + lw * 0.62, ly + lh * 0.07); g.lineTo(lx + lw * 0.55, ly + lh * 0.18); g.lineTo(lx + lw * 0.69, ly + lh * 0.18); g.closePath(); g.fill();
        g.fillStyle = '#3f7fae'; g.fillRect(lx, ly + lh * 0.44, lw, lh * 0.16);   // lake
        g.fillStyle = '#4e9a3d'; g.fillRect(lx, ly + lh * 0.58, lw, lh * 0.42);   // green field
        g.fillStyle = '#3c7d30'; g.fillRect(lx, ly + lh * 0.58, lw, 2);
        // tiny figures: yellow farmer + brown cow
        g.fillStyle = '#e3c93a'; g.fillRect(lx + lw * 0.24, ly + lh * 0.70, 4, 8);
        g.fillStyle = '#caa46a'; g.fillRect(lx + lw * 0.30, ly + lh * 0.72, 4, 7);
        g.fillStyle = '#7a5230'; g.fillRect(lx + lw * 0.5, ly + lh * 0.74, 9, 6);
        g.fillStyle = '#fff'; g.fillRect(lx + lw * 0.66, ly + lh * 0.66, 5, 5);
        // frame around the panel
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2; g.strokeRect(lx, ly, lw, lh);
        // bottom white banner
        g.fillStyle = '#f2f4f2'; g.fillRect(0, h * 0.84, w, h * 0.1);
        g.fillStyle = '#7a2222'; g.font = 'bold 11px sans-serif';
        g.fillText('APPENZELLER BIER', w * 0.5, h * 0.89);
        // cylinder shading + light grunge
        var sh = g.createLinearGradient(0, 0, w, 0);
        sh.addColorStop(0, 'rgba(0,0,0,.30)'); sh.addColorStop(0.5, 'rgba(255,255,255,.10)'); sh.addColorStop(1, 'rgba(0,0,0,.30)');
        g.fillStyle = sh; g.fillRect(0, 0, w, h);
        grunge(g, w, h, 0.1);
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      }, true);
      var canTopTex = ctex(48, 48, function (g, w, h) {
        g.fillStyle = '#bfc3c6'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#8b8f92'; g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h / 2, w * 0.42, 0, 7); g.stroke();
        g.fillStyle = '#9a9ea1'; g.beginPath(); g.ellipse(w * 0.58, h * 0.4, w * 0.16, h * 0.09, 0, 0, 7); g.fill();
        g.fillStyle = '#1b1d21'; g.beginPath(); g.ellipse(w * 0.43, h * 0.53, w * 0.18, h * 0.1, 0.3, 0, 7); g.fill();
        grunge(g, w, h, 0.15);
      }, true);
      // cigarette-pack wrap (teal box, white top strip — no logo)
      var cigPackTex = ctex(64, 96, function (g, w, h) {
        g.fillStyle = '#1d6b60'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#e9ece6'; g.fillRect(0, 0, w, h * 0.15);
        g.fillStyle = '#12463e'; g.fillRect(0, h * 0.15, w, 2);
        g.strokeStyle = 'rgba(225,232,225,.55)'; g.lineWidth = 3;
        g.beginPath(); g.arc(w / 2, h * 0.66, w * 0.3, Math.PI * 0.92, Math.PI * 1.58); g.stroke();
        grunge(g, w, h, 0.18);
      }, true);
      // plain white poster placeholder for the back wall
      var posterTex = ctex(96, 132, function (g, w, h) {
        g.fillStyle = '#eeece5'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#d2cfc6'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
        grunge(g, w, h, 0.05);
      });
      // USB body wrap with a pixelated "NUDES" label
      var usbLabelTex = ctex(112, 40, function (g, w, h) {
        g.fillStyle = '#243657'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff'; g.font = 'bold 26px monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('NUDES', w / 2, h / 2 + 2);
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        grunge(g, w, h, 0.05);
      }, true);
      // grey ash bed with scattered black ash + butts debris
      var ashBedTex = ctex(64, 64, function (g, w, h) {
        g.fillStyle = '#8f8c83'; g.fillRect(0, 0, w, h);
        for (var i = 0; i < 90; i++) {
          g.fillStyle = 'rgba(24,20,16,' + (0.35 + Math.random() * 0.5).toFixed(2) + ')';
          var s = 1 + (Math.random() * 2 | 0);
          g.fillRect(Math.random() * w | 0, Math.random() * h | 0, s, s);
        }
        for (var j = 0; j < 30; j++) {
          g.fillStyle = 'rgba(210,205,195,' + (0.2 + Math.random() * 0.3).toFixed(2) + ')';
          g.fillRect(Math.random() * w | 0, Math.random() * h | 0, 1, 1);
        }
        grunge(g, w, h, 0.18);
      }, true);
      var mousepadTex = ctex(256, 200, function (g, w, h) {
        g.fillStyle = '#191b20'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#252f39';
        g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.66, h * 0.18); g.lineTo(w, h * 0.46); g.lineTo(w, h); g.closePath(); g.fill();
        g.fillStyle = '#3a2a55';
        g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.4, h * 0.55); g.lineTo(w * 0.9, h); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(130,160,180,.22)'; g.lineWidth = 3; g.strokeRect(7, 7, w - 14, h - 14);
        g.fillStyle = 'rgba(160,180,200,.55)'; g.font = 'bold 16px monospace'; g.fillText('NONAME', 16, 30);
      });

      var PH = function (o) { return ps1(new T.MeshPhongMaterial(o)); };
      var beige = PH({ color: 0xd7ceb5, specular: 0x3a382f, shininess: 18 });
      var beige2 = PH({ color: 0xc7bea0, specular: 0x33312a, shininess: 14 });
      var darkM = PH({ color: 0x202024, specular: 0x222222, shininess: 26 });
      var grayM = PH({ color: 0xdad4c5, specular: 0x4a4a4a, shininess: 26 });
      var wallM = PH({ map: wallTex, color: 0xc6cacf, specular: 0x0e0e0e, shininess: 3 });
      var floorM = PH({ color: 0x131316, specular: 0x000000, shininess: 1 });
      var deskM = PH({ map: deskTex, color: 0xb6b4ad, specular: 0x6c695f, shininess: 24 });
      var towerFront = PH({ map: towerTex, specular: 0x2a2a26, shininess: 12 });
      var keyTop = PH({ map: keyTex, specular: 0x2a2a26, shininess: 10 });
      var padM = PH({ map: mousepadTex, specular: 0x141414, shininess: 30 });
      this.screenMat = ps1(new T.MeshBasicMaterial({ map: screenTex }));
      var bezelM = PH({ color: 0xd9d0b8, specular: 0x33312a, shininess: 16 });
      var trimM = PH({ color: 0x15130f, specular: 0x1a1a1a, shininess: 10 });
      var ventM = PH({ map: ventTex, specular: 0x2a2a26, shininess: 10 });
      var bezelLabelM = PH({ map: bezelLabelTex, specular: 0x2a2a26, shininess: 14 });
      // PS2-era props: flat-shaded, matte, hard-edged
      var PHF = function (o) { o.flatShading = true; return ps1(new T.MeshPhongMaterial(o)); };
      var ashBodyM = PHF({ color: 0xc7b492, specular: 0x2a2620, shininess: 5 });
      var ashBedM = PHF({ map: ashBedTex, specular: 0x161410, shininess: 2 });
      var buttPaperM = PHF({ color: 0xe9e4d5, specular: 0x1a1a1a, shininess: 3 });
      var cigCorkM = PHF({ color: 0xc79a52, specular: 0x1a1a1a, shininess: 4 });
      var ashTipM = PHF({ color: 0x2e2a26, specular: 0x0a0a0a, shininess: 2 });
      var canSideM = PHF({ map: beerTex, specular: 0x8a8a8a, shininess: 34 });
      var canTopM = PHF({ map: canTopTex, specular: 0x7a7a7a, shininess: 30 });
      var canBottomM = PHF({ color: 0xc0c4c7, specular: 0x7a7a7a, shininess: 30 });
      var packBodyM = PHF({ map: cigPackTex, specular: 0x1a1a1a, shininess: 6 });
      var packFoilM = PHF({ color: 0xd8dad4, specular: 0x444444, shininess: 16 });
      var posterM = PHF({ map: posterTex, specular: 0x0a0a0a, shininess: 2 });
      var posterFrameM = PHF({ color: 0xb8b4a8, specular: 0x161616, shininess: 5 });
      // artwork poster (loaded from the supplied image) for the left wall slot
      var posterArtM = posterM;
      var posterArt2M = posterM;
      if (window.POSTER_SONIC) {
        var artTex2 = new T.TextureLoader().load(window.POSTER_SONIC);
        artTex2.encoding = T.sRGBEncoding; artTex2.anisotropy = 4;
        posterArt2M = PHF({ map: artTex2, specular: 0x0a0a0a, shininess: 2 });
      }
      if (window.POSTER_XMAS) {
        var artTex = new T.TextureLoader().load(window.POSTER_XMAS);
        artTex.encoding = T.sRGBEncoding;
        artTex.anisotropy = 4;
        posterArtM = PHF({ map: artTex, specular: 0x0a0a0a, shininess: 2 });
      }
      var usbBodyM = PHF({ color: 0x2a3d63, specular: 0x334466, shininess: 22 });
      var usbLabelM = PHF({ map: usbLabelTex, specular: 0x334466, shininess: 18 });
      var usbCapM = PHF({ color: 0x14202f, specular: 0x223344, shininess: 18 });
      var usbMetalM = PHF({ color: 0xbfc3c7, specular: 0x9aa0a4, shininess: 60 });

      var add = function (geo, mat, x, y, z, rx, ry, rz) {
        var m = new T.Mesh(geo, mat); m.position.set(x, y, z);
        if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
        m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
      };
      var B = function (w, h, d) { return new T.BoxGeometry(w, h, d); };
      var P = function (w, h) { return new T.PlaneGeometry(w, h); };

      add(B(14, 0.4, 12), floorM, 0, -0.5, 0);
      add(B(14, 7, 0.3), wallM, 0, 2.6, -1.85);
      add(B(0.3, 7, 12), wallM, 3.2, 2.6, -0.6);
      add(B(3.7, 0.16, 1.65), deskM, 0, 0.69, -0.35);
      var DESK_TOP = 0.77;

      // MONITOR (angled group; front = +z)
      var mg = new T.Group(); mg.position.set(-0.16, 0.77, -0.42); mg.rotation.y = -0.24; scene.add(mg);
      var mk = function (geo, mat, x, y, z) {
        var m = new T.Mesh(geo, mat); m.position.set(x, y, z);
        m.castShadow = true; m.receiveShadow = true; mg.add(m); return m;
      };
      mk(B(0.7, 0.6, 0.38), beige, 0, 0.46, -0.44);
      var body = mk(B(0.94, 0.82, 0.5), beige, 0, 0.46, -0.08);
      var vL = new T.Mesh(P(0.34, 0.5), ventM); vL.rotation.y = -Math.PI / 2; vL.position.set(-0.471, 0.46, -0.12); vL.receiveShadow = true; mg.add(vL);
      var vR = new T.Mesh(P(0.34, 0.5), ventM); vR.rotation.y = Math.PI / 2; vR.position.set(0.471, 0.46, -0.12); vR.receiveShadow = true; mg.add(vR);
      mk(B(0.58, 0.05, 0.44), beige2, 0, 0.025, 0.02);
      mk(B(0.4, 0.09, 0.32), beige2, 0, 0.095, 0.0);
      mk(B(0.24, 0.11, 0.26), beige2, 0, 0.185, -0.02);
      var bez = mk(B(0.88, 0.72, 0.1), bezelM, 0, 0.48, 0.16);
      var bezLabel = new T.Mesh(P(0.88, 0.72), bezelLabelM); bezLabel.position.set(0, 0.48, 0.211); mg.add(bezLabel);
      var trim = new T.Mesh(P(0.7, 0.56), trimM); trim.position.set(0, 0.5, 0.213); mg.add(trim);
      var screen = new T.Mesh(P(0.64, 0.5), this.screenMat);
      screen.position.set(0, 0.5, 0.215); screen.castShadow = false; mg.add(screen);

      // TOWER
      var tg = new T.Group(); tg.position.set(1.02, 0.77, -0.5); tg.rotation.y = -0.06; scene.add(tg);
      var tw = new T.Mesh(B(0.5, 1.08, 0.96), beige); tw.position.y = 0.54; tw.castShadow = true; tw.receiveShadow = true; tg.add(tw);
      var tf = new T.Mesh(P(0.46, 1.02), towerFront); tf.position.set(0, 0.54, 0.481); tg.add(tf);

      // KEYBOARD
      var kg = new T.Group(); kg.position.set(-0.2, 0.78, 0.36); kg.rotation.x = -0.06; kg.rotation.y = 0.07; scene.add(kg);
      var kb = new T.Mesh(B(1.22, 0.06, 0.46), beige2); kb.castShadow = true; kb.receiveShadow = true; kg.add(kb);
      var kt = new T.Mesh(P(1.16, 0.42), keyTop); kt.rotation.x = -Math.PI / 2; kt.position.y = 0.031; kt.receiveShadow = true; kg.add(kt);

      // MOUSEPAD + MOUSE
      if (window.PAD_SKIN) {
        var padSkinTex = new T.TextureLoader().load(window.PAD_SKIN);
        padSkinTex.encoding = T.sRGBEncoding; padSkinTex.anisotropy = 4;
        var padSkinM = ps1(new T.MeshPhongMaterial({ map: padSkinTex, transparent: true, alphaTest: 0.5, specular: 0x141414, shininess: 16 }));
        var PADW = 0.5244, PADHT = PADW * 521 / 509;
        var padTop = new T.Mesh(P(PADW, PADHT), padSkinM);
        padTop.rotation.x = -Math.PI / 2; padTop.position.set(0.74, DESK_TOP + 0.006, 0.24); padTop.receiveShadow = true; scene.add(padTop);
      } else {
        add(B(0.52, 0.014, 0.4), darkM, 0.74, DESK_TOP + 0.007, 0.22);
        var padTop = new T.Mesh(P(0.52, 0.4), padM); padTop.rotation.x = -Math.PI / 2; padTop.position.set(0.74, DESK_TOP + 0.015, 0.22); padTop.receiveShadow = true; scene.add(padTop);
      }
      // classic beige ball mouse: rounded low-poly shell, button seams, scroll
      // wheel, darker base, cord running off toward the tower (front = -z)
      var ms = new T.Group(); ms.position.set(0.83, DESK_TOP + 0.007, 0.2); ms.rotation.y = -0.16; scene.add(ms);
      var mSeamM = PHF({ color: 0x45413a, specular: 0x0a0a0a, shininess: 6 });
      var mBaseM = PHF({ color: 0xbdb49c, specular: 0x333333, shininess: 20 });
      var mWheelM = PHF({ color: 0xc9ccd1, specular: 0x555555, shininess: 30 });
      var mBase = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 12), mBaseM);
      mBase.scale.set(0.0475, 0.016, 0.078);
      mBase.position.set(0, 0.008, 0.01); mBase.castShadow = true; mBase.receiveShadow = true; ms.add(mBase);
      // shell: scaled low-poly hemisphere (R=0.08), flat-shaded
      var MR = 0.08, MSX = 0.64, MSY = 0.52, MSZ = 1.04, MDY = 0.016, MDZ = 0.01;
      var mShell = new T.Mesh(new T.SphereGeometry(MR, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), grayM);
      mShell.scale.set(MSX, MSY, MSZ);
      mShell.position.set(0, MDY, MDZ);
      mShell.castShadow = true; mShell.receiveShadow = true; ms.add(mShell);
      // panel seams: thin tubes lying on the shell surface
      var seamTube = function (pts) {
        var m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.0026, 5, false), mSeamM);
        ms.add(m); return m;
      };
      var surf = function (xu, yu, zu) { // unscaled sphere point -> shell surface (pushed slightly proud)
        return new T.Vector3(xu * MSX * 1.006, yu * MSY * 1.006 + MDY, zu * MSZ * 1.006 + MDZ);
      };
      // seam across the shell (separates buttons from palm rest)
      var zc = -0.024, rc = Math.sqrt(MR * MR - zc * zc), sa = [];
      for (var st = 0; st <= 10; st++) { var th = (st / 10) * Math.PI; sa.push(surf(rc * Math.cos(th), rc * Math.sin(th), zc)); }
      seamTube(sa);
      // seam down the middle of the buttons (front rim up to the cross seam)
      var sm = [], psiMax = Math.acos(-zc / MR);
      for (var sp = 0; sp <= 8; sp++) { var ps = 0.06 + (sp / 8) * (psiMax - 0.06); sm.push(surf(0, MR * Math.sin(ps), -MR * Math.cos(ps))); }
      seamTube(sm);
      // scroll wheel: just a sliver showing through a slim dark slot
      var mSlot = new T.Mesh(B(0.018, 0.012, 0.042), darkM);
      mSlot.position.set(0, 0.043, -0.036); mSlot.rotation.x = 0.3; ms.add(mSlot);
      var mWheel = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 0.01, 10), mWheelM);
      mWheel.rotation.z = Math.PI / 2;
      mWheel.position.set(0, 0.04, -0.036); ms.add(mWheel);
      // cord: hugs the desk, runs alongside the tower and disappears behind it
      var cordPts = [
        new T.Vector3(0.843, DESK_TOP + 0.018, 0.119),
        new T.Vector3(0.71, DESK_TOP + 0.016, -0.01),
        new T.Vector3(0.695, DESK_TOP + 0.006, -0.18),
        new T.Vector3(0.715, DESK_TOP + 0.006, -0.45),
        new T.Vector3(0.735, DESK_TOP + 0.006, -0.72),
        new T.Vector3(0.80, DESK_TOP + 0.006, -0.92),
      ];
      var mCord = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(cordPts), 24, 0.0055, 5, false), grayM);
      mCord.castShadow = true; mCord.receiveShadow = true; scene.add(mCord);

      // ---- STANDING PHOTO FRAME (left of the monitor) ----
      var pfG = new T.Group(); pfG.position.set(-1.02, DESK_TOP + 0.004, -0.56); pfG.rotation.y = 0.42; scene.add(pfG);
      var pfTilt = new T.Group(); pfTilt.rotation.x = -0.14; pfG.add(pfTilt);
      var FW = 0.24, FH = 0.3, FD = 0.02;
      var pfFrameM = PHF({ color: 0x1a181d, emissive: 0x000000, specular: 0x111111, shininess: 18 });
      var pfMatM = PHF({ color: 0xf2efe9, specular: 0x111111, shininess: 4 });
      var pfStandM = PHF({ color: 0x9a6b42, specular: 0x111111, shininess: 6 });
      var pfBox = new T.Mesh(B(FW, FH, FD), pfFrameM);
      pfBox.position.y = FH / 2; pfBox.castShadow = true; pfBox.receiveShadow = true; pfTilt.add(pfBox);
      var pfMat = new T.Mesh(P(FW * 0.8, FH * 0.84), pfMatM);
      pfMat.position.set(0, FH / 2, FD / 2 + 0.0012); pfTilt.add(pfMat);
      var pfPhotoM = pfMatM;
      if (window.DESK_PHOTO) {
        var phTex = new T.TextureLoader().load(window.DESK_PHOTO);
        phTex.encoding = T.sRGBEncoding; phTex.anisotropy = 4;
        pfPhotoM = PHF({ map: phTex, specular: 0x0a0a0a, shininess: 3 });
      }
      var pfPhoto = new T.Mesh(P(FW * 0.645, FH * 0.6467), pfPhotoM);
      pfPhoto.position.set(0, FH / 2, FD / 2 + 0.0024); pfTilt.add(pfPhoto);
      // kickstand wedge propping it up from behind
      var pfStand = new T.Mesh(B(0.085, FH * 0.62, 0.012), pfStandM);
      pfStand.rotation.x = 0.46;
      pfStand.position.set(0, 0.088, -0.08);
      pfStand.castShadow = true; pfG.add(pfStand);

      // ---- ASHTRAY + CIGARETTES + PACK + BEER CANS (chunky, low-poly, PS2 style) ----

      // a used cigarette butt centered at origin: burnt ash tip at -x, white paper, cork filter at +x
      var makeButt = function (len) {
        var g2 = new T.Group();
        var r = 0.0095, corkLen = len * 0.34, ashLen = len * 0.14, paperLen = len - corkLen - ashLen;
        var seg = function (mat, x0, l, rad) {
          var m = new T.Mesh(new T.CylinderGeometry(rad, rad, l, 7), mat);
          m.rotation.z = Math.PI / 2; m.position.x = x0 + l / 2; m.castShadow = true; g2.add(m);
        };
        seg(ashTipM, -len / 2, ashLen, r * 0.9);
        seg(buttPaperM, -len / 2 + ashLen, paperLen, r);
        seg(cigCorkM, -len / 2 + ashLen + paperLen, corkLen, r);
        return g2;
      };

      // ashtray: chunky hexagonal tan dish with a recessed grey ash bed
      var ashG = new T.Group(); ashG.position.set(-1.0, DESK_TOP, 0.24); ashG.rotation.y = 0.4; scene.add(ashG);
      var RIM_TOP = 0.055;
      var ashBody = new T.Mesh(new T.CylinderGeometry(0.145, 0.125, RIM_TOP, 6), ashBodyM);
      ashBody.position.y = RIM_TOP / 2; ashBody.castShadow = true; ashBody.receiveShadow = true; ashG.add(ashBody);
      var ashBed = new T.Mesh(new T.CylinderGeometry(0.108, 0.095, 0.04, 6), ashBedM);
      ashBed.position.y = RIM_TOP - 0.018; ashBed.receiveShadow = true; ashG.add(ashBed);

      // four used cigarettes: cork end up on the rim, burnt end down in the ash, pointing at the centre
      var placeButt = function (deg, len) {
        var pivot = new T.Group();
        pivot.rotation.y = deg * Math.PI / 180;
        pivot.position.y = 0.048;
        var c = makeButt(len);
        c.rotation.z = 0.18;            // cork (+x) end lifts up toward the rim
        c.position.x = len * 0.35;      // slide out so cork rests on the rim, ash tip near centre
        pivot.add(c); ashG.add(pivot);
      };
      placeButt(30, 0.16);
      placeButt(120, 0.135);
      placeButt(205, 0.15);
      placeButt(300, 0.125);

      // cigarette pack: upright box, open flip-top, filter tips poking out
      var packG = new T.Group(); packG.position.set(-0.86, DESK_TOP, 0.02); packG.rotation.y = 0.5; scene.add(packG);
      var packW = 0.1, packH = 0.15, packD = 0.045;
      var packBody = new T.Mesh(B(packW, packH, packD), packBodyM);
      packBody.position.y = packH / 2; packBody.castShadow = true; packBody.receiveShadow = true; packG.add(packBody);
      var packLid = new T.Mesh(B(packW, packH * 0.3, packD), packBodyM);
      packLid.position.set(0, packH + 0.012, -packD * 0.42); packLid.rotation.x = -0.7; packLid.castShadow = true; packG.add(packLid);
      var packFoil = new T.Mesh(B(packW * 0.88, 0.012, packD * 0.78), packFoilM);
      packFoil.position.y = packH + 0.004; packG.add(packFoil);
      for (var ci = 0; ci < 6; ci++) {
        var cwx = -packW * 0.28 + (ci % 3) * packW * 0.28;
        var cdz = -packD * 0.16 + Math.floor(ci / 3) * packD * 0.32;
        var stick = 0.025 + ((ci * 37) % 30) / 1000;
        var cg = new T.Group(); cg.position.set(cwx, packH + 0.006, cdz); packG.add(cg);
        var cbody = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.04 + stick, 8), buttPaperM);
        cbody.position.y = (0.04 + stick) / 2; cbody.castShadow = true; cg.add(cbody);
        var ctip = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.014, 8), cigCorkM);
        ctip.position.y = 0.04 + stick + 0.007; cg.add(ctip);
      }

      // two beer cans: tall, chunky, faceted low-poly cylinders
      this.beerTargets = [];
      var self2 = this;
      var makeCan = function (x, z, rotY) {
        var g2 = new T.Group(); g2.position.set(x, DESK_TOP, z); g2.rotation.y = rotY; scene.add(g2);
        var side = new T.Mesh(new T.CylinderGeometry(0.05, 0.053, 0.2, 12, 1, true), canSideM);
        side.position.y = 0.1; side.castShadow = true; side.receiveShadow = true; g2.add(side);
        var neck = new T.Mesh(new T.CylinderGeometry(0.042, 0.05, 0.03, 12, 1, true), canSideM);
        neck.position.y = 0.215; neck.castShadow = true; g2.add(neck);
        var top = new T.Mesh(new T.CylinderGeometry(0.042, 0.042, 0.006, 12), canTopM);
        top.position.y = 0.232; top.castShadow = true; g2.add(top);
        var bot = new T.Mesh(new T.CylinderGeometry(0.053, 0.053, 0.008, 12), canBottomM);
        bot.position.y = 0.004; g2.add(bot);
        self2.beerTargets.push(side, neck, top);
        return g2;
      };
      makeCan(-1.4, -0.02, 0.6);
      makeCan(-1.24, -0.24, -0.4);

      // cassette front-left
      add(B(0.2, 0.035, 0.12), darkM, -0.72, DESK_TOP + 0.0175, 0.52, 0, 0.26, 0);

      // USB stick (clickable Easter egg): rests on the desk, plugs into the tower
      var usbG = new T.Group(); scene.add(usbG);
      var usbBody = new T.Mesh(B(0.075, 0.026, 0.032), usbBodyM);
      usbBody.castShadow = true; usbBody.receiveShadow = true; usbG.add(usbBody);
      var usbLabel = new T.Mesh(P(0.056, 0.03), usbLabelM);
      usbLabel.rotation.x = -Math.PI / 2; usbLabel.position.set(0.007, 0.0132, 0); usbG.add(usbLabel);
      var usbCap = new T.Mesh(B(0.018, 0.03, 0.036), usbCapM);
      usbCap.position.x = -0.03; usbCap.castShadow = true; usbG.add(usbCap);
      var usbMetal = new T.Mesh(B(0.03, 0.016, 0.022), usbMetalM);
      usbMetal.position.x = 0.05; usbMetal.castShadow = true; usbG.add(usbMetal);
      var usbSlot = new T.Mesh(B(0.014, 0.008, 0.012), usbCapM);
      usbSlot.position.x = 0.058; usbG.add(usbSlot);
      // resting pose: flat on the desk in the open gap in front of the monitor
      usbG.scale.setScalar(1.18);
      this.usbHome = { pos: new T.Vector3(-0.18, DESK_TOP + 0.0153, -0.02), rot: new T.Euler(0, -0.6, 0) };
      // plugged pose: connector inserted into the tower's lower front
      this.usbPort = { pos: new T.Vector3(0.86, 0.9, 0.03), rot: new T.Euler(0, Math.PI / 2, 0) };
      usbG.position.copy(this.usbHome.pos); usbG.rotation.copy(this.usbHome.rot);
      this.usbGroup = usbG;
      this.usbTargets = [usbBody, usbCap, usbMetal];
      this.usbPlugged = false;

      // CD "BANGERS" (click to load into the tower, click again to eject)
      var cdTex = ctex(160, 160, function (g, w, h) {
        var cx = w / 2, cy = h / 2;
        var rg = g.createRadialGradient(cx, cy, w * 0.09, cx, cy, w * 0.5);
        rg.addColorStop(0, '#cbd0d5'); rg.addColorStop(0.45, '#eef1f4');
        rg.addColorStop(0.72, '#c4c9ce'); rg.addColorStop(0.9, '#e2e6ea'); rg.addColorStop(1, '#9aa0a6');
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, w * 0.5, 0, 7); g.fill();
        // faint rainbow sheen arcs
        g.lineWidth = 5;
        g.strokeStyle = 'rgba(120,205,225,.35)'; g.beginPath(); g.arc(cx, cy, w * 0.36, 3.7, 5.1); g.stroke();
        g.strokeStyle = 'rgba(225,160,205,.30)'; g.beginPath(); g.arc(cx, cy, w * 0.30, 0.5, 2.0); g.stroke();
        g.strokeStyle = 'rgba(200,220,150,.28)'; g.beginPath(); g.arc(cx, cy, w * 0.42, 1.2, 2.6); g.stroke();
        // BANGERS title
        g.fillStyle = '#16161c'; g.font = 'bold 22px sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('BANGERS', cx, cy - w * 0.22);
        // hub ring + centre hole
        g.strokeStyle = '#9aa0a6'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, w * 0.15, 0, 7); g.stroke();
        g.fillStyle = '#d8dbdf'; g.beginPath(); g.arc(cx, cy, w * 0.12, 0, 7); g.fill();
        g.fillStyle = '#2a2d33'; g.beginPath(); g.arc(cx, cy, w * 0.065, 0, 7); g.fill();
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      });
      var cdTopM = PH({ map: cdTex, specular: 0x9a9a9a, shininess: 80 });
      var cdEdgeM = PH({ color: 0xbabec3, specular: 0x888888, shininess: 60 });
      var cdG = new T.Group(); scene.add(cdG);
      var cdMesh = new T.Mesh(new T.CylinderGeometry(0.1012, 0.1012, 0.004, 28), [cdEdgeM, cdTopM, cdTopM]);
      cdMesh.castShadow = true; cdMesh.receiveShadow = true; cdG.add(cdMesh);
      // resting pose: flat on the desk in the open gap between monitor and tower
      this.cdHome = { pos: new T.Vector3(0.4, DESK_TOP + 0.004, -0.12), rot: new T.Euler(0, 0.5, 0) };
      // loaded pose: stood upright, half-inserted into the tower's top drive bay
      this.cdSlot = { pos: new T.Vector3(0.86, 1.63, 0.12), rot: new T.Euler(Math.PI / 2, 0, -0.06) };
      cdG.position.copy(this.cdHome.pos); cdG.rotation.copy(this.cdHome.rot);
      this.cdGroup = cdG;
      this.cdTargets = [cdMesh];
      this.cdInserted = false;

      // two big white poster placeholders on the back wall (wall front face at z = -1.70)
      var makePoster = function (x, y, pw, ph, mat) {
        var frame = new T.Mesh(P(pw + 0.05, ph + 0.05), posterFrameM);
        frame.position.set(x, y, -1.697); frame.receiveShadow = true; scene.add(frame);
        var panel = new T.Mesh(P(pw, ph), mat || posterM);
        panel.position.set(x, y, -1.69); panel.receiveShadow = true; scene.add(panel);
      };
      makePoster(-1.12, 1.72, 0.85, 1.134, posterArtM);
      makePoster(0.5, 1.95, 0.945, 1.26, posterArt2M);

      // compute screen-facing fly-in target from the angled monitor
      mg.updateWorldMatrix(true, true);
      this.SCREEN_CTR = screen.getWorldPosition(new T.Vector3());
      var nrm = new T.Vector3(0, 0, 1).applyQuaternion(mg.getWorldQuaternion(new T.Quaternion())).normalize();
      this.IN_POS = this.SCREEN_CTR.clone().add(nrm.multiplyScalar(0.5));
      this.clickTargets = [screen, bez];
      this.cigTargets = [packBody, packLid];

      // lights
      scene.add(new T.AmbientLight(0x46443e, 0.5));
      scene.add(new T.HemisphereLight(0xbab29c, 0x2a2722, 0.7));
      var key = new T.DirectionalLight(0xffeccf, 1.15);
      key.position.set(2.6, 4.4, 2.8); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 0.5; key.shadow.camera.far = 16;
      key.shadow.camera.left = -3.2; key.shadow.camera.right = 3.2; key.shadow.camera.top = 3.2; key.shadow.camera.bottom = -3.2;
      key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02; scene.add(key);
      var fill = new T.DirectionalLight(0x90a2b4, 0.28); fill.position.set(-2.6, 1.6, 1.6); scene.add(fill);
      var glow = new T.PointLight(0x7bd8ff, 0.5, 3.4); glow.position.copy(this.SCREEN_CTR).add(new T.Vector3(0, 0, 0.32)); scene.add(glow);

      // desktop icons (Win95): draw pixel-art icons and wire clicks
      var iconTypeFor = function (app) { return app === 'notepad' ? 'notepad' : app === 'recycle' ? 'recycle' : 'folder'; };
      Array.prototype.forEach.call(els.desktop.querySelectorAll('.dicon'), function (ic) {
        var app = ic.getAttribute('data-app');
        self.drawIcon(ic.querySelector('canvas'), iconTypeFor(app));
        ic.addEventListener('click', function () { self.openWindow(app); });
      });
      self.drawIcon(els.startFlag, 'flag');
      els.startBtn.addEventListener('click', function () { self.beep(); });

      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect();
        self.mx = ((e.clientX - r.left) / r.width) * 2 - 1;
        self.my = -(((e.clientY - r.top) / r.height) * 2 - 1);
        if (self.view === 'desk' && !self.tween) {
          self.ray.setFromCamera(new T.Vector2(self.mx, self.my), cam);
          var hit = self.ray.intersectObjects(self.clickTargets, false).length ||
            (!self.smoking && self.ray.intersectObjects(self.cigTargets, false).length) ||
            (!self.drinking && self.ray.intersectObjects(self.beerTargets, false).length) ||
            (!self.usbTween && self.ray.intersectObjects(self.usbTargets, false).length) ||
            (!self.cdTween && self.ray.intersectObjects(self.cdTargets, false).length);
          canvas.style.cursor = hit ? 'pointer' : 'default';
        }
      });
      stage.addEventListener('pointerdown', function () {
        self.initAudio();
        if (self.introActive) return;
        if (self.view === 'desk' && !self.tween) {
          self.ray.setFromCamera(new T.Vector2(self.mx, self.my), cam);
          if (self.ray.intersectObjects(self.clickTargets, false).length) { self.flyIn(); return; }
          if (!self.usbTween && self.ray.intersectObjects(self.usbTargets, false).length) { self.toggleUsb(); return; }
          if (!self.cdTween && self.ray.intersectObjects(self.cdTargets, false).length) { self.toggleCd(); return; }
          if (!self.drinking && self.ray.intersectObjects(self.beerTargets, false).length) { self.drinkBeer(); return; }
          if (!self.smoking && self.ray.intersectObjects(self.cigTargets, false).length) self.smoke();
        }
      });
      els.dialogueBox.addEventListener('click', function (e) { e.stopPropagation(); self.advanceIntro(); });

      // taskbar tray clock
      var tick = function () {
        var d = new Date(), h = d.getHours(), ap = h < 12 ? 'AM' : 'PM';
        var h12 = h % 12; if (h12 === 0) h12 = 12;
        els.trayClock.textContent = h12 + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + ap;
      };
      tick(); this.clockTimer = setInterval(tick, 15000);

      // loop
      var clock = new T.Clock();
      var animate = function () {
        if (self._dead) return;
        self.raf = requestAnimationFrame(animate);
        var dt = Math.min(0.05, clock.getDelta());
        if (self.tween) {
          var tw = self.tween; tw.t += dt / tw.dur; var k = Math.min(1, tw.t);
          var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          cam.position.copy(tw.from.pos.clone().lerp(tw.to.pos, e));
          cam.lookAt(tw.from.look.clone().lerp(tw.to.look, e));
          if (k >= 1) { var f = tw.onDone; self.tween = null; if (f) f(); }
        } else if (self.view === 'desk') {
          var tx = self.BASE.x + self.mx * 0.20, ty = self.BASE.y + self.my * 0.12;
          cam.position.x += (tx - cam.position.x) * 0.05;
          cam.position.y += (ty - cam.position.y) * 0.05;
          cam.position.z += (self.BASE.z - cam.position.z) * 0.05;
          cam.lookAt(self.LOOK);
        }
        if (self.usbTween) {
          var ut = self.usbTween; ut.t += dt / ut.dur; var uk = Math.min(1, ut.t);
          var ue = uk < .5 ? 2 * uk * uk : 1 - Math.pow(-2 * uk + 2, 2) / 2;
          self.usbGroup.position.copy(ut.from.pos.clone().lerp(ut.to.pos, ue));
          self.usbGroup.rotation.set(
            ut.from.rot.x + (ut.to.rot.x - ut.from.rot.x) * ue,
            ut.from.rot.y + (ut.to.rot.y - ut.from.rot.y) * ue,
            ut.from.rot.z + (ut.to.rot.z - ut.from.rot.z) * ue
          );
          if (uk >= 1) { var uf = ut.onDone; self.usbTween = null; if (uf) uf(); }
        }
        if (self.cdTween) {
          var ct = self.cdTween; ct.t += dt / ct.dur; var ck = Math.min(1, ct.t);
          var ce = ck < .5 ? 2 * ck * ck : 1 - Math.pow(-2 * ck + 2, 2) / 2;
          self.cdGroup.position.copy(ct.from.pos.clone().lerp(ct.to.pos, ce));
          self.cdGroup.rotation.set(
            ct.from.rot.x + (ct.to.rot.x - ct.from.rot.x) * ce,
            ct.from.rot.y + (ct.to.rot.y - ct.from.rot.y) * ce,
            ct.from.rot.z + (ct.to.rot.z - ct.from.rot.z) * ce
          );
          if (ck >= 1) { var cf = ct.onDone; self.cdTween = null; if (cf) cf(); }
        }
        if (self.screenMat) self.screenMat.color.setScalar(0.95 + Math.random() * 0.07);
        renderer.render(scene, cam);
      };
      animate();

      setTimeout(function () { if (!self._dead) self.startIntro(); }, 700);
    },

    smoke: function () {
      if (this.smoking) return;
      this.smoking = true; this.click();
      var self = this, fx = els.fx, fctx = fx.getContext('2d');

      // render at the scene's own resolution so the sprite stays sharp
      var rect = els.stage.getBoundingClientRect();
      var CW = Math.max(1, Math.round(rect.width)), CH = Math.max(1, Math.round(rect.height));
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      fx.width = Math.round(CW * dpr); fx.height = Math.round(CH * dpr);
      fx.style.display = 'block';
      els.hint.style.display = 'none';

      // the reference artwork, used verbatim as the animation sprite
      if (!this._handImg) {
        this._handImg = new Image();
        this._handImg.src = window.HAND_SPRITE || './assets/hand.png';
      }
      var img = this._handImg;

      // where the lit end of the cigarette sits inside the sprite (fraction of w/h)
      var TIPX = 0.268, TIPY = 0.020;

      var particles = [];
      var start = performance.now(); var DUR = 4200;
      var draw = function (now) {
        if (self._dead) return;
        var t = now - start;
        fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fctx.clearRect(0, 0, CW, CH);

        var enter = Math.min(1, t / 700);
        var exitStart = 3300, exit = t > exitStart ? Math.min(1, (t - exitStart) / 780) : 0;
        var raise = Math.max(0, Math.min(1, (1 - Math.pow(1 - enter, 3)) - exit * exit));

        // sprite layout: arm enters from the lower right, cigarette up and to the left
        var drawH = CH * 0.86;
        var drawW = drawH * (img.width && img.height ? img.width / img.height : 760 / 714);
        var restY = CH * 0.15;                    // held position
        var dy = restY + (1 - raise) * CH * 1.05; // slides up from below the frame
        var dx = CW * 0.42;

        // gentle sway so the hold doesn't feel frozen
        var sway = Math.sin(t / 620) * 0.012 * raise;
        var cxp = dx + drawW * TIPX, cyp = dy + drawH * TIPY;

        var tipx = dx + drawW * TIPX, tipy = dy + drawH * TIPY;
        // account for the sway rotation about the sprite centre
        (function () {
          var ox = dx + drawW * 0.5, oy = dy + drawH * 0.5;
          var c = Math.cos(sway), s = Math.sin(sway);
          var rx = tipx - ox, ry = tipy - oy;
          tipx = ox + rx * c - ry * s; tipy = oy + rx * s + ry * c;
        })();

        // ---- smoke rising from the cigarette tip ----
        if (t > 850 && t < 3400 && raise > 0.6) {
          for (var sp = 0; sp < 2; sp++) {
            particles.push({ x: tipx + (Math.random() - 0.5) * CH * 0.012, y: tipy,
              r: CH * (0.004 + Math.random() * 0.003), life: 0,
              vx: (Math.random() - 0.5) * CH * 0.030, vy: -CH * (0.030 + Math.random() * 0.022) });
          }
        }
        particles.forEach(function (p) { p.life += 16; p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.r += CH * 0.00022; });
        particles = particles.filter(function (p) { return p.life < 2300; });
        particles.forEach(function (p) {
          var k = p.life / 2300;
          var a = Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) * (1 - k) * 0.30;
          if (a <= 0.002) return;
          var pg = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          pg.addColorStop(0, 'rgba(214,218,215,' + a.toFixed(3) + ')');
          pg.addColorStop(1, 'rgba(214,218,215,0)');
          fctx.fillStyle = pg;
          fctx.beginPath(); fctx.arc(p.x, p.y, p.r, 0, 7); fctx.fill();
        });

        // ---- the hand sprite ----
        if (img.complete && img.naturalWidth) {
          fctx.save();
          fctx.translate(dx + drawW * 0.5, dy + drawH * 0.5);
          fctx.rotate(sway);
          fctx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
          fctx.restore();
        }

        // ---- ember at the lit tip ----
        if (raise > 0.5) {
          var pulse = 0.72 + Math.sin(t / 300) * 0.28;
          var er = CH * 0.011;
          var eg = fctx.createRadialGradient(tipx, tipy, 0, tipx, tipy, er);
          eg.addColorStop(0, 'rgba(255,196,96,' + (0.80 * pulse).toFixed(3) + ')');
          eg.addColorStop(0.45, 'rgba(233,92,28,' + (0.50 * pulse).toFixed(3) + ')');
          eg.addColorStop(1, 'rgba(233,92,28,0)');
          fctx.fillStyle = eg;
          fctx.beginPath(); fctx.arc(tipx, tipy, er, 0, 7); fctx.fill();
          fctx.fillStyle = 'rgba(255,214,140,' + (0.85 * pulse).toFixed(3) + ')';
          fctx.beginPath(); fctx.arc(tipx, tipy, CH * 0.0032, 0, 7); fctx.fill();
        }

        if (t < DUR) {
          self.smokeRaf = requestAnimationFrame(draw);
        } else {
          fx.style.display = 'none';
          fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fx.width, fx.height);
          self.smoking = false;
          if (self.view === 'desk') els.hint.style.display = 'block';
        }
      };
      self.smokeRaf = requestAnimationFrame(draw);
    },

    drinkBeer: function () {
      if (this.drinking) return;
      this.drinking = true; this.beep();
      this.playBeerSound();
      var self = this, fx = els.fx, fctx = fx.getContext('2d');

      var rect = els.stage.getBoundingClientRect();
      var CW = Math.max(1, Math.round(rect.width)), CH = Math.max(1, Math.round(rect.height));
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      fx.width = Math.round(CW * dpr); fx.height = Math.round(CH * dpr);
      fx.style.display = 'block';
      els.hint.style.display = 'none';

      // the reference beer artwork, used verbatim as the animation sprite
      if (!this._beerImg) {
        this._beerImg = new Image();
        this._beerImg.src = window.BEER_SPRITE || './assets/beer.png';
      }
      var img = this._beerImg;

      var start = performance.now(); var DUR = 4300;
      var draw = function (now) {
        if (self._dead) return;
        var t = now - start;
        fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fctx.clearRect(0, 0, CW, CH);

        var enter = Math.min(1, t / 650);
        var exitStart = 3450, exit = t > exitStart ? Math.min(1, (t - exitStart) / 780) : 0;
        var raise = Math.max(0, Math.min(1, (1 - Math.pow(1 - enter, 3)) - exit * exit));

        // drink tilt: ramps up during the gulp then back down (0 -> 1 -> 0)
        var tilt = 0;
        if (t > 780 && t < 3250) tilt = Math.sin(((t - 780) / (3250 - 780)) * Math.PI);

        var drawH = CH * 0.94;
        var drawW = drawH * (img.width && img.height ? img.width / img.height : 760 / 822);
        var restY = CH * 0.10;
        // lift the whole arm toward the face as you tip it back
        var dy = restY + (1 - raise) * CH * 1.05 - tilt * CH * 0.12;
        var dx = CW * 0.40 - tilt * CW * 0.05;

        // tip the can back toward the mouth (top-centre); gentle sway otherwise
        var rot = 0.62 * tilt + Math.sin(t / 620) * 0.01 * raise * (1 - tilt);

        if (img.complete && img.naturalWidth) {
          fctx.save();
          // pivot low (near the wrist) so the base swings up and the opening tips to the lips
          fctx.translate(dx + drawW * 0.5, dy + drawH * 0.74);
          fctx.rotate(rot);
          fctx.drawImage(img, -drawW * 0.5, -drawH * 0.74, drawW, drawH);
          fctx.restore();
        }

        if (t < DUR) {
          self.drinkRaf = requestAnimationFrame(draw);
        } else {
          fx.style.display = 'none';
          fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fx.width, fx.height);
          self.drinking = false;
          if (self.view === 'desk') els.hint.style.display = 'block';
        }
      };
      self.drinkRaf = requestAnimationFrame(draw);
    },

    toggleUsb: function () {
      if (this.usbTween) return;
      var self = this, T = window.THREE;
      var toPlugged = !this.usbPlugged;
      this.click(); this.blip(toPlugged ? 1500 : 640, 0.06, 'square');
      var dest = toPlugged ? this.usbPort : this.usbHome;
      this.usbTween = {
        from: { pos: this.usbGroup.position.clone(), rot: this.usbGroup.rotation.clone() },
        to: { pos: dest.pos.clone(), rot: dest.rot.clone() },
        t: 0, dur: 0.7,
        onDone: function () {
          self.usbPlugged = toPlugged;
          self.updateNudesFolder();
        },
      };
    },
    updateNudesFolder: function () {
      if (!els.deskIcons) return;
      var existing = document.getElementById('nudesIcon');
      if (this.usbPlugged && !existing) {
        var self = this;
        var f = document.createElement('div');
        f.className = 'dicon'; f.id = 'nudesIcon'; f.setAttribute('data-app', 'nudes');
        var cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
        self.drawIcon(cv, 'folder');
        var lbl = document.createElement('span'); lbl.textContent = 'NUDES';
        f.appendChild(cv); f.appendChild(lbl);
        f.addEventListener('click', function () { self.openWindow('nudes'); });
        els.deskIcons.appendChild(f);
      } else if (!this.usbPlugged && existing) {
        existing.remove();
      }
    },
    toggleCd: function () {
      if (this.cdTween) return;
      var self = this;
      var toIn = !this.cdInserted;
      this.click(); this.blip(toIn ? 1200 : 520, 0.06, 'square');
      var dest = toIn ? this.cdSlot : this.cdHome;
      this.cdTween = {
        from: { pos: this.cdGroup.position.clone(), rot: this.cdGroup.rotation.clone() },
        to: { pos: dest.pos.clone(), rot: dest.rot.clone() },
        t: 0, dur: 0.8,
        onDone: function () {
          self.cdInserted = toIn;
          self.updateBangersFile();
        },
      };
    },
    updateBangersFile: function () {
      if (!els.deskIcons) return;
      var existing = document.getElementById('bangersIcon');
      if (this.cdInserted && !existing) {
        var self = this;
        var f = document.createElement('div');
        f.className = 'dicon'; f.id = 'bangersIcon'; f.setAttribute('data-app', 'bangers');
        var cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
        self.drawIcon(cv, 'cd');
        var lbl = document.createElement('span'); lbl.textContent = 'Bangers';
        f.appendChild(cv); f.appendChild(lbl);
        f.addEventListener('click', function () { self.openWindow('bangers'); });
        els.deskIcons.appendChild(f);
      } else if (!this.cdInserted && existing) {
        existing.remove();
      }
    },

    /* ---------- Win95 pixel-art icons ---------- */
    drawIcon: function (cv, type) {
      if (!cv) return;
      var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, cv.width, cv.height);
      var s = cv.width / 32;
      g.save(); g.scale(s, s);
      if (type === 'folder') {
        g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(6, 26, 22, 3);
        g.fillStyle = '#fff'; g.fillRect(10, 5, 15, 12);
        g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(10.5, 5.5, 14, 11);
        g.fillStyle = '#2731c8';
        for (var i = 0; i < 4; i++) g.fillRect(12, 8 + i * 2, 11, 1);
        g.fillStyle = '#e0b400'; g.fillRect(4, 9, 12, 4);
        g.fillStyle = '#ffd94a'; g.fillRect(4, 12, 24, 15);
        g.fillStyle = '#ffe986'; g.fillRect(4, 12, 24, 3);
        g.fillStyle = '#d9ad10'; g.fillRect(4, 24, 24, 3);
        g.strokeStyle = '#000'; g.strokeRect(4.5, 11.5, 23, 15);
      } else if (type === 'notepad') {
        g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(9, 27, 17, 2);
        g.fillStyle = '#fff'; g.fillRect(8, 8, 17, 20);
        g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(8.5, 8.5, 16, 19);
        g.fillStyle = '#c8c8c8';
        for (var j = 0; j < 6; j++) g.fillRect(11, 15 + j * 2, 11, 1);
        g.fillStyle = '#63d3d0'; g.fillRect(7, 6, 20, 9);
        g.strokeStyle = '#000'; g.strokeRect(7.5, 6.5, 19, 8);
        g.fillStyle = '#0c5a58';
        for (var a = 0; a < 9; a++) for (var b = 0; b < 4; b++) if ((a + b) % 2 === 0) g.fillRect(9 + a * 2, 8 + b * 2, 1, 1);
        g.fillStyle = '#1a1a1a'; g.fillRect(10, 8, 8, 2);
        g.fillStyle = '#000';
        for (var k = 0; k < 8; k++) g.fillRect(8 + k * 2.3, 5, 1, 3);
      } else if (type === 'recycle') {
        g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(9, 27, 16, 2);
        g.fillStyle = '#c8ccd4';
        g.beginPath(); g.moveTo(9, 12); g.lineTo(23, 12); g.lineTo(21, 28); g.lineTo(11, 28); g.closePath(); g.fill();
        g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
        g.strokeStyle = '#8890a0';
        g.beginPath(); g.moveTo(13, 13); g.lineTo(12.4, 27); g.moveTo(16, 13); g.lineTo(16, 27); g.moveTo(19, 13); g.lineTo(19.6, 27); g.stroke();
        g.fillStyle = '#d4d8e0'; g.fillRect(7, 9, 18, 4);
        g.strokeStyle = '#000'; g.strokeRect(7.5, 9.5, 17, 3);
        g.fillStyle = '#cfd3db'; g.fillRect(13, 6, 6, 3);
        g.strokeRect(13.5, 6.5, 5, 2);
        g.fillStyle = '#1f8a2a';
        g.beginPath(); g.moveTo(13, 17); g.lineTo(16, 15); g.lineTo(16, 19); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(19, 21); g.lineTo(16, 23); g.lineTo(16, 19); g.closePath(); g.fill();
      } else if (type === 'cd') {
        g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(16, 28, 11, 2.5, 0, 0, 7); g.fill();
        g.fillStyle = '#dfe2e6'; g.beginPath(); g.arc(16, 15, 12, 0, 7); g.fill();
        g.strokeStyle = '#9aa0a6'; g.lineWidth = 1; g.stroke();
        g.strokeStyle = '#79cfe0'; g.lineWidth = 2; g.beginPath(); g.arc(16, 15, 9, 3.7, 5.2); g.stroke();
        g.strokeStyle = '#e0a0d0'; g.beginPath(); g.arc(16, 15, 7, 0.6, 2.2); g.stroke();
        g.fillStyle = '#eef1f4'; g.beginPath(); g.arc(16, 15, 4, 0, 7); g.fill();
        g.strokeStyle = '#9aa0a6'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#33363c'; g.beginPath(); g.arc(16, 15, 2, 0, 7); g.fill();
      } else if (type === 'flag') {
        g.restore(); g.save();
        var fs = cv.width / 18;
        g.scale(fs, fs);
        g.fillStyle = '#e84a3a'; g.fillRect(1, 2, 7, 5);
        g.fillStyle = '#3aa63a'; g.fillRect(9, 2, 7, 5);
        g.fillStyle = '#3a6ad0'; g.fillRect(1, 8, 7, 5);
        g.fillStyle = '#e8b23a'; g.fillRect(9, 8, 7, 5);
      }
      g.restore();
    },

    startIntro: function () {
      if (this._introShown) return;
      this._introShown = true; this.introActive = true; this.introIndex = 0;
      els.hint.style.display = 'none';
      els.dialogueLine.textContent = this.introMessages[0];
      els.dialogue.style.display = 'block';
    },
    advanceIntro: function () {
      if (!this.introActive) return;
      this.initAudio(); this.blip(900, 0.03);
      this.introIndex++;
      if (this.introIndex < this.introMessages.length) {
        els.dialogueLine.textContent = this.introMessages[this.introIndex];
      } else {
        this.introActive = false;
        els.dialogue.style.display = 'none';
        if (this.view === 'desk') els.hint.style.display = 'block';
      }
    },

    flyIn: function () {
      if (this.view !== 'desk' || this.tween) return;
      if (this.smoking || this.drinking) {
        this.smoking = false; this.drinking = false;
        if (this.smokeRaf) cancelAnimationFrame(this.smokeRaf);
        if (this.drinkRaf) cancelAnimationFrame(this.drinkRaf);
        if (els.fx) { els.fx.style.display = 'none'; els.fx.getContext('2d').clearRect(0, 0, els.fx.width, els.fx.height); }
      }
      this.click(); this.view = 'trans';
      els.hint.style.display = 'none';
      els.canvas.style.cursor = 'default';
      var self = this;
      this.tween = {
        from: { pos: this.cam.position.clone(), look: this.LOOK.clone() },
        to: { pos: this.IN_POS.clone(), look: this.SCREEN_CTR.clone() },
        t: 0, dur: 1.25,
        onDone: function () { self.view = 'screen'; self.enterDesktop(); },
      };
    },
    flyOut: function () {
      if (this.view !== 'screen') return;
      this.click(); this.view = 'trans';
      els.overlay.style.display = 'none';
      els.overlay.style.pointerEvents = 'none';
      var self = this;
      this.tween = {
        from: { pos: this.cam.position.clone(), look: this.SCREEN_CTR.clone() },
        to: { pos: this.BASE.clone(), look: this.LOOK.clone() },
        t: 0, dur: 1.05,
        onDone: function () { self.view = 'desk'; els.hint.style.display = 'block'; els.muteBtn.style.display = ''; },
      };
    },
    enterDesktop: function () {
      els.overlay.style.display = 'block';
      els.overlay.style.pointerEvents = 'auto';
      els.muteBtn.style.display = 'none';
      this.updateNudesFolder();
      this.updateBangersFile();
      this.beep();
      if (!this._quizDone) this.startQuiz();
    },

    /* ---------- desktop intro quiz (modal Win95 error dialogs) ---------- */
    startQuiz: function () {
      els.introModal.style.display = 'flex';
      this.showQuizNode('q1');
    },
    showQuizNode: function (id) {
      var self = this, node = this.quizTree[id];
      if (!node) return;
      // error-style alert sound
      this.initAudio(); this.blip(id === 'wrong' ? 320 : 640, 0.09); this.blip(id === 'wrong' ? 240 : 500, 0.12);
      els.introMsg.innerHTML = node.msg.replace(/\n/g, '<br>');
      els.introBtns.innerHTML = '';
      node.buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'dlg-btn'; btn.textContent = b.label;
        btn.addEventListener('click', function () {
          self.click();
          if (b.go === 'DONE') self.finishQuiz();
          else self.showQuizNode(b.go);
        });
        els.introBtns.appendChild(btn);
      });
      var first = els.introBtns.querySelector('.dlg-btn');
      if (first) first.focus();
    },
    finishQuiz: function () {
      this._quizDone = true;
      els.introModal.style.display = 'none';
      this.beep();
    },

    /* ---------- Win95 windows ---------- */
    loadGallery: function (bodyEl) {
      var self = this;
      var grid = bodyEl.querySelector('.gal-grid');
      var countEl = bodyEl.querySelector('.gal-count');
      if (!grid) return;
      var emptyMsg = '<div class="gal-empty"><b>This folder is empty.</b>' +
        '<span>Add images to <b>gallery/originals/</b> &mdash; they appear here automatically.</span></div>';
      fetch('./gallery/manifest.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('no manifest'); return r.json(); })
        .then(function (items) {
          if (!items || !items.length) { grid.classList.add('gal-msg'); grid.innerHTML = emptyMsg; if (countEl) countEl.textContent = '0 object(s)'; return; }
          grid.classList.remove('gal-msg');
          grid.innerHTML = '';
          items.forEach(function (it, idx) {
            var cell = document.createElement('button');
            cell.type = 'button'; cell.className = 'gal-cell';
            var img = document.createElement('img');
            img.loading = 'lazy'; img.decoding = 'async';
            img.src = './gallery/' + it.thumb;
            img.alt = it.alt || it.id || ('image ' + (idx + 1));
            cell.appendChild(img);
            cell.addEventListener('click', function () { self.openLightbox(items, idx); });
            grid.appendChild(cell);
          });
          if (countEl) countEl.textContent = items.length + ' object(s)';
        })
        .catch(function () { grid.classList.add('gal-msg'); grid.innerHTML = emptyMsg; if (countEl) countEl.textContent = '0 object(s)'; });
    },
    openLightbox: function (items, idx) {
      var self = this;
      var lb = this._lb;
      if (!lb) {
        lb = document.createElement('div'); lb.className = 'gal-lightbox';
        lb.innerHTML =
          '<div class="glb-backdrop"></div>' +
          '<img class="glb-img" alt="">' +
          '<button class="glb-close" type="button" aria-label="Close">&#10005;</button>' +
          '<button class="glb-nav glb-prev" type="button" aria-label="Previous">&#8249;</button>' +
          '<button class="glb-nav glb-next" type="button" aria-label="Next">&#8250;</button>' +
          '<div class="glb-cap"></div>';
        els.desktop.appendChild(lb);
        var close = function () { lb.classList.remove('open'); };
        lb.querySelector('.glb-close').addEventListener('click', close);
        lb.querySelector('.glb-backdrop').addEventListener('click', close);
        lb.querySelector('.glb-prev').addEventListener('click', function (e) { e.stopPropagation(); self._lbGo(-1); });
        lb.querySelector('.glb-next').addEventListener('click', function (e) { e.stopPropagation(); self._lbGo(1); });
        document.addEventListener('keydown', function (e) {
          if (!lb.classList.contains('open')) return;
          if (e.key === 'Escape') close();
          else if (e.key === 'ArrowLeft') self._lbGo(-1);
          else if (e.key === 'ArrowRight') self._lbGo(1);
        });
        this._lb = lb;
      }
      this._lbItems = items; this._lbIdx = idx;
      this._lbShow(); lb.classList.add('open'); this.blip(660, 0.03);
    },
    _lbGo: function (d) {
      if (!this._lbItems) return;
      var n = this._lbItems.length;
      this._lbIdx = (this._lbIdx + d + n) % n;
      this._lbShow();
    },
    _lbShow: function () {
      var it = this._lbItems[this._lbIdx];
      var img = this._lb.querySelector('.glb-img');
      var cap = this._lb.querySelector('.glb-cap');
      img.src = './gallery/' + it.full;
      img.alt = it.alt || it.id || '';
      if (cap) cap.textContent = (this._lbIdx + 1) + ' / ' + this._lbItems.length;
      var multi = this._lbItems.length > 1;
      this._lb.querySelector('.glb-prev').style.display = multi ? '' : 'none';
      this._lb.querySelector('.glb-next').style.display = multi ? '' : 'none';
    },
    winInfo: function (kind) {
      var menu = '<div class="win-menu"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>H</u>elp</span></div>';
      if (kind === 'images') {
        return { title: 'IMAGES', icon: 'folder', width: 470, height: 360,
          body: menu + '<div class="win-inset gal-inset"><div class="gal-grid">Loading gallery&hellip;</div></div><div class="win-status"><span class="gal-count">&mdash;</span></div>' };
      }
      if (kind === 'noname') {
        return { title: 'NONAME', icon: 'folder', width: 320,
          body: menu + '<div class="win-inset"><b>noname.txt</b><br>&gt; this file has no name.<br>&gt; contents not yet written.<br><br>[ PLACEHOLDER ]</div>' };
      }
      if (kind === 'nudes') {
        return { title: 'NUDES', icon: 'folder', width: 320,
          body: menu + '<div class="win-inset win-empty"><b>This folder is empty.</b><span>0 object(s) &mdash; [ PLACEHOLDER ]</span></div>' };
      }
      if (kind === 'bangers') {
        return { title: 'Bangers', icon: 'cd', width: 340,
          body: menu + '<div class="win-inset"><b>BANGERS.M3U</b><br>&gt; 01 &mdash; track one<br>&gt; 02 &mdash; track two<br>&gt; 03 &mdash; track three<br><br>[ PLACEHOLDER &mdash; add your tracks ]</div>' };
      }
      if (kind === 'notepad') {
        return { title: 'Untitled - Notepad', icon: 'notepad', width: 360,
          body: '<div class="win-menu"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>S</u>earch</span><span><u>H</u>elp</span></div><div class="np-area"><span class="np-caret">|</span></div>' };
      }
      // recycle
      return { title: 'Recycle Bin', icon: 'recycle', width: 340,
        body: menu + '<div class="win-inset win-empty"><b>The Recycle Bin is empty.</b><span>[ PLACEHOLDER ]</span></div>' };
    },
    focusWindow: function (win) {
      var list = els.windows.querySelectorAll('.win');
      for (var i = 0; i < list.length; i++) list[i].classList.remove('active');
      win.classList.add('active');
      win.style.zIndex = String(++this.zTop);
    },
    minimizeWindow: function (st) {
      var self = this;
      st.win.style.display = 'none';
      st.win.classList.remove('active');
      if (st.tab) return;
      var tab = document.createElement('button'); tab.type = 'button'; tab.className = 'tb-tab';
      var ic = document.createElement('canvas'); ic.width = 16; ic.height = 16; self.drawIcon(ic, st.icon);
      var lbl = document.createElement('span'); lbl.textContent = st.title;
      tab.appendChild(ic); tab.appendChild(lbl);
      tab.addEventListener('click', function () { self.click(); st.restore(); });
      els.taskbarTabs.appendChild(tab);
      st.tab = tab;
    },
    openWindow: function (kind) {
      this.beep();
      var self = this, layer = els.windows; if (!layer) return;
      var info = this.winInfo(kind);
      var n = this.winCount % 6; this.winCount++;
      var x = 56 + n * 26, y = 40 + n * 24;

      var win = document.createElement('div');
      win.className = 'win active';
      win.style.left = x + 'px'; win.style.top = y + 'px'; win.style.width = info.width + 'px';
      if (info.height) win.style.height = info.height + 'px';

      var title = document.createElement('div'); title.className = 'win-title';
      var tIcon = document.createElement('canvas'); tIcon.width = 16; tIcon.height = 16; tIcon.className = 'win-titleicon';
      this.drawIcon(tIcon, info.icon);
      var nm = document.createElement('div'); nm.className = 'win-name'; nm.textContent = info.title;
      var ctrls = document.createElement('div'); ctrls.className = 'win-controls';
      var bMin = document.createElement('button'); bMin.type = 'button'; bMin.className = 'wc wc-min'; bMin.innerHTML = '<i></i>';
      var bMax = document.createElement('button'); bMax.type = 'button'; bMax.className = 'wc wc-max'; bMax.innerHTML = '<i></i>';
      var bClose = document.createElement('button'); bClose.type = 'button'; bClose.className = 'wc wc-close'; bClose.textContent = '✕';
      ctrls.appendChild(bMin); ctrls.appendChild(bMax); ctrls.appendChild(bClose);
      title.appendChild(tIcon); title.appendChild(nm); title.appendChild(ctrls);

      var body = document.createElement('div'); body.className = 'win-body'; body.innerHTML = info.body;

      var grip = document.createElement('div'); grip.className = 'win-resize';

      win.appendChild(title); win.appendChild(body); win.appendChild(grip); layer.appendChild(win);
      this.focusWindow(win);

      var st = { win: win, kind: kind, title: info.title, icon: info.icon, maximized: false, prev: null, tab: null };
      st.restore = function () { win.style.display = ''; self.focusWindow(win); if (st.tab) { st.tab.remove(); st.tab = null; } };

      win.addEventListener('pointerdown', function () { self.focusWindow(win); });

      if (kind === 'images') self.loadGallery(body);

      bClose.addEventListener('click', function (ev) { ev.stopPropagation(); self.click(); if (st.tab) st.tab.remove(); win.remove(); });
      bMin.addEventListener('click', function (ev) { ev.stopPropagation(); self.click(); self.minimizeWindow(st); });
      var doMax = function (ev) {
        if (ev) ev.stopPropagation(); self.blip(700, 0.03);
        if (!st.maximized) {
          st.prev = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
          win.style.left = '0'; win.style.top = '0'; win.style.width = '100%'; win.style.height = 'calc(100% - 30px)';
          st.maximized = true;
        } else {
          win.style.left = st.prev.left; win.style.top = st.prev.top;
          win.style.width = st.prev.width; win.style.height = st.prev.height || '';
          st.maximized = false;
        }
        self.focusWindow(win);
      };
      bMax.addEventListener('click', doMax);
      title.addEventListener('dblclick', doMax);

      var drag = false, ox = 0, oy = 0;
      title.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.win-controls') || st.maximized) return;
        drag = true;
        var r = win.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
        self.focusWindow(win);
        try { title.setPointerCapture(e.pointerId); } catch (_) {}
      });
      title.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var pr = layer.getBoundingClientRect();
        var nx = Math.max(0, Math.min(pr.width - 40, e.clientX - pr.left - ox));
        var ny = Math.max(0, Math.min(pr.height - 40, e.clientY - pr.top - oy));
        win.style.left = nx + 'px'; win.style.top = ny + 'px';
      });
      title.addEventListener('pointerup', function () { drag = false; });

      // bottom-right resize grip: drag to make the window bigger/smaller
      var rez = false, sx = 0, sy = 0, sw = 0, sh = 0;
      grip.addEventListener('pointerdown', function (e) {
        if (st.maximized) return;
        e.stopPropagation();
        rez = true;
        var r = win.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height;
        self.focusWindow(win);
        try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      });
      grip.addEventListener('pointermove', function (e) {
        if (!rez) return;
        win.style.width = Math.max(200, sw + (e.clientX - sx)) + 'px';
        win.style.height = Math.max(120, sh + (e.clientY - sy)) + 'px';
      });
      grip.addEventListener('pointerup', function () { rez = false; });
      return st;
    },
  };

  els.muteBtn.addEventListener('click', function () { App.toggleMute(); });
  els.backBtn.addEventListener('click', function () { App.flyOut(); });
  els.muteBtn.textContent = 'SOUND: ' + (App.muted ? 'OFF' : 'ON');

  var wait = function () {
    if (window.THREE) {
      try { App.init(); } catch (e) { console.error(e); }
    } else {
      setTimeout(wait, 40);
    }
  };
  wait();
})();
