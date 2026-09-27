/**
 * ARGUS Robotics - Main Website Interactivity
 */

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initMobileNav();
  initPreviewFeeds();
  initFailsafeDemo();
});

/* Theme Toggle Support */
function initThemeToggle() {
  const savedTheme = localStorage.getItem('argus_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      if (next === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      try {
        localStorage.setItem('argus_theme', next);
      } catch (e) {
        console.warn('localStorage theme error:', e);
      }
    });
  });
}

/* Mobile Navigation Toggle */
function initMobileNav() {
  const menuBtn = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');

  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', isOpen);
    });

    // Close when clicking link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
}

/* Live Canvas-based Camera Feed Simulators using Real Rover Camera Footage */
const cameraFeedImg = new Image();
cameraFeedImg.src = new URL('../assets/rover-camera-feed.jpg', import.meta.url).href;

function initPreviewFeeds() {
  const normalCanvas = document.getElementById('normalFeedCanvas');
  const aiCanvas = document.getElementById('aiFeedCanvas');

  if (normalCanvas) {
    drawWarehouseFeed(normalCanvas, false);
  }
  if (aiCanvas) {
    drawWarehouseFeed(aiCanvas, true);
  }
}

function drawWarehouseFeed(canvas, showYolo) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let animFrameId;
  let t = 0;

  function drawCornerBracket(ctx, x, y, w, h, len, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Top-left
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    // Top-right
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    // Bottom-left
    ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h);
    // Bottom-right
    ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
  }

  function drawHighContrastLabel(ctx, text, subtext, x, y, color, isBottom = false) {
    ctx.font = '700 12px "JetBrains Mono", monospace';
    const mainWidth = ctx.measureText(text).width;
    ctx.font = '500 10px "JetBrains Mono", monospace';
    const subWidth = subtext ? ctx.measureText(subtext).width : 0;
    
    const textWidth = Math.max(mainWidth, subWidth);
    const badgeWidth = textWidth + 24;
    const badgeHeight = subtext ? 32 : 22;
    const badgeY = isBottom ? y + 6 : y - badgeHeight - 4;

    // Solid dark slate contrast background for 100% legibility
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.fillRect(x, badgeY, badgeWidth, badgeHeight);
    
    // Left color accent bar
    ctx.fillStyle = color;
    ctx.fillRect(x, badgeY, 4, badgeHeight);

    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, badgeY, badgeWidth, badgeHeight);

    // Text label (Bright white)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.fillText(text, x + 10, badgeY + (subtext ? 14 : 15));

    if (subtext) {
      ctx.fillStyle = color;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(subtext, x + 10, badgeY + 26);
    }
  }

  function render() {
    t += 0.02;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 270;

    // Draw real rover camera photograph background
    if (cameraFeedImg.complete && cameraFeedImg.naturalWidth > 0) {
      ctx.drawImage(cameraFeedImg, 0, 0, w, h);
    } else {
      // Fallback while loading
      ctx.fillStyle = '#11161d';
      ctx.fillRect(0, 0, w, h);
    }

    // Camera HUD Telemetry Overlays
    // Top Left: Feed Status
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(10, 10, showYolo ? 210 : 180, 24);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(10, 10, showYolo ? 210 : 180, 24);

    // Live Indicator Dot
    ctx.fillStyle = showYolo ? '#B88932' : '#10B981';
    ctx.beginPath();
    ctx.arc(20, 22, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillText(showYolo ? 'AI PERCEPTION • YOLOv8' : 'OPTICAL FEED • RAW', 30, 26);

    // Top Right: Live Timestamp
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + Math.floor(now.getMilliseconds() / 100);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(w - 145, 10, 135, 24);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(w - 145, 10, 135, 24);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillText(`REC  ${timeStr}`, w - 137, 26);

    // Center Camera Reticle
    const cx = w * 0.5;
    const cy = h * 0.48;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
    ctx.stroke();

    // AI Perception Overlay (YOLOv8)
    if (showYolo) {
      // 1. PERSON / TECHNICIAN (Left Aisle)
      const pX = w * 0.23;
      const pY = h * 0.31;
      const pW = w * 0.09;
      const pH = h * 0.26;

      ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
      ctx.fillRect(pX, pY, pW, pH);
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(pX, pY, pW, pH);
      drawCornerBracket(ctx, pX - 2, pY - 2, pW + 4, pH + 4, 8, '#3B82F6');
      drawHighContrastLabel(ctx, 'PERSON 98%', 'ID: #012 • ACTIVE', pX, pY, '#3B82F6');

      // 2. HAZARDOUS CHEMICAL CONTAINERS (Right Foreground)
      const cX = w * 0.65;
      const cY = h * 0.26;
      const cW = w * 0.33;
      const cH = h * 0.41;

      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.fillRect(cX, cY, cW, cH);
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cX, cY, cW, cH);
      drawCornerBracket(ctx, cX - 2, cY - 2, cW + 4, cH + 4, 10, '#F59E0B');
      drawHighContrastLabel(ctx, 'CHEMICAL BARREL 96%', 'CLASS 3 • FLAMMABLE', cX, cY, '#F59E0B');

      // 3. STORAGE CONTAINER / PALLET RACK (Center Racks)
      const rX = w * 0.41;
      const rY = h * 0.03;
      const rW = w * 0.21;
      const rH = h * 0.58;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.fillRect(rX, rY, rW, rH);
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rX, rY, rW, rH);
      drawCornerBracket(ctx, rX - 2, rY - 2, rW + 4, rH + 4, 8, '#10B981');
      drawHighContrastLabel(ctx, 'STORAGE CONTAINER 94%', 'BAY_04 • VERIFIED', rX, rY + 30, '#10B981', true);

      // 4. CLEAR PATHWAY / OBSTACLE ZONE (Ground Aisle)
      const oX = w * 0.18;
      const oY = h * 0.58;
      const oW = w * 0.44;
      const oH = h * 0.34;

      ctx.fillStyle = 'rgba(6, 182, 212, 0.05)';
      ctx.fillRect(oX, oY, oW, oH);
      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(oX, oY, oW, oH);
      ctx.setLineDash([]);
      drawHighContrastLabel(ctx, 'CLEAR PATHWAY 99%', 'NAV MESH OK', oX + 8, oY + oH - 38, '#06B6D4', true);

      // Scanning Beam Line
      const scanY = (t * 70) % h;
      const scanGrad = ctx.createLinearGradient(0, scanY - 6, 0, scanY + 6);
      scanGrad.addColorStop(0, 'rgba(184, 137, 50, 0)');
      scanGrad.addColorStop(0.5, 'rgba(184, 137, 50, 0.35)');
      scanGrad.addColorStop(1, 'rgba(184, 137, 50, 0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 6, w, 12);
    }

    // Natural camera noise / video scanlines effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
    }

    animFrameId = requestAnimationFrame(render);
  }

  // Ensure image triggers re-render when loaded
  cameraFeedImg.onload = () => {
    if (!animFrameId) render();
  };

  render();

  window.addEventListener('resize', () => {
    canvas.width = canvas.clientWidth || 480;
    canvas.height = canvas.clientHeight || 270;
  });
}

/* Fail-Safe Interactive Simulation on Homepage */
function initFailsafeDemo() {
  const triggerBtn = document.getElementById('demoFailsafeBtn');
  const statusText = document.getElementById('demoFailsafeStatus');

  if (triggerBtn && statusText) {
    let triggered = false;
    triggerBtn.addEventListener('click', () => {
      triggered = !triggered;
      if (triggered) {
        statusText.textContent = 'COMMUNICATION TIMEOUT (>500ms) → AUTO STOPPED';
        statusText.style.color = 'var(--status-danger)';
        triggerBtn.textContent = 'Simulate Normal Heartbeat';
      } else {
        statusText.textContent = 'NORMAL OPERATION (HEARTBEAT OK)';
        statusText.style.color = 'var(--status-normal)';
        triggerBtn.textContent = 'Simulate 500ms Signal Loss';
      }
    });
  }
}
