/**
 * AURA • Universal Video Downloader App Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Input & Controls
  const analyzeForm = document.getElementById('analyze-form');
  const urlInput = document.getElementById('video-url-input');
  const clearInputBtn = document.getElementById('clear-input-btn');
  const pasteBtn = document.getElementById('paste-btn');
  const analyzeBtn = document.getElementById('analyze-btn');
  const sampleChips = document.querySelectorAll('.sample-chip');

  // DOM Elements - Sections
  const analysisLoader = document.getElementById('analysis-loader');
  const previewCard = document.getElementById('video-preview-card');
  const progressCard = document.getElementById('download-progress-card');
  const successCard = document.getElementById('download-success-card');

  // DOM Elements - Preview Details
  const videoThumb = document.getElementById('video-thumb');
  const videoDuration = document.getElementById('video-duration');
  const previewPlayBtn = document.getElementById('preview-play-btn');
  const platformBadge = document.getElementById('platform-badge');
  const videoTitle = document.getElementById('video-title');
  const videoUploader = document.getElementById('video-uploader');
  const tabVideo = document.getElementById('tab-video');
  const tabAudio = document.getElementById('tab-audio');
  const formatOptionsGrid = document.getElementById('format-options-grid');
  const selectedSizeEstimate = document.getElementById('selected-size-estimate');
  const startDownloadBtn = document.getElementById('start-download-btn');
  const downloadBtnText = document.getElementById('download-btn-text');

  // DOM Elements - Progress Monitoring
  const progressJobTitle = document.getElementById('progress-job-title');
  const progressStatusDesc = document.getElementById('progress-status-desc');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const metricPercent = document.getElementById('metric-percent');
  const metricSpeed = document.getElementById('metric-speed');
  const metricEta = document.getElementById('metric-eta');
  const metricFormat = document.getElementById('metric-format');
  const cancelDownloadBtn = document.getElementById('cancel-download-btn');

  // DOM Elements - Success Card
  const successFilename = document.getElementById('success-filename');
  const successSaveBtn = document.getElementById('success-save-btn');
  const successPlayBtn = document.getElementById('success-play-btn');
  const downloadAnotherBtn = document.getElementById('download-another-btn');

  // DOM Elements - History Drawer
  const historyToggleBtn = document.getElementById('history-toggle-btn');
  const historyDrawer = document.getElementById('history-drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const closeHistoryBtn = document.getElementById('close-history-btn');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const historyList = document.getElementById('history-list');

  // DOM Elements - Video Modal
  const videoPlayerModal = document.getElementById('video-player-modal');
  const modalVideoElement = document.getElementById('modal-video-element');
  const modalPlayerTitle = document.getElementById('modal-player-title');
  const closeModalBtn = document.getElementById('close-modal-btn');

  // Application State
  let currentMetadata = null;
  let selectedFormat = null;
  let activeMediaType = 'video'; // 'video' or 'audio'
  let activeJobId = null;
  let progressInterval = null;

  // Initialize History
  HistoryManager.updateBadge();

  /* ==========================================================================
     Event Listeners - URL Inputs & Samples
     ========================================================================== */

  // Input changes
  urlInput.addEventListener('input', () => {
    if (urlInput.value.trim().length > 0) {
      clearInputBtn.classList.remove('hidden');
    } else {
      clearInputBtn.classList.add('hidden');
    }
  });

  // Clear button
  clearInputBtn.addEventListener('click', () => {
    urlInput.value = '';
    clearInputBtn.classList.add('hidden');
    urlInput.focus();
  });

  // Paste from Clipboard button
  pasteBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          clearInputBtn.classList.remove('hidden');
          showToast('info', 'Clipboard Pasted', 'URL inserted into input.');
          analyzeUrl(text.trim());
        }
      } else {
        showToast('warning', 'Clipboard Access', 'Clipboard API unavailable. Please paste manually (Ctrl+V).');
      }
    } catch (err) {
      showToast('warning', 'Clipboard Permission', 'Please permit clipboard access or paste with Ctrl+V.');
    }
  });

  // Quick sample chips
  sampleChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.getAttribute('data-url');
      urlInput.value = url;
      clearInputBtn.classList.remove('hidden');
      analyzeUrl(url);
    });
  });

  // Analyze Form submit
  analyzeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) {
      showToast('error', 'URL Required', 'Please enter a video URL to proceed.');
      return;
    }
    analyzeUrl(url);
  });

  /* ==========================================================================
     Media Analysis (POST /api/analyze)
     ========================================================================== */

  async function analyzeUrl(url) {
    // Reset views
    hideAllCards();
    analysisLoader.classList.remove('hidden');
    setAnalyzeButtonLoading(true);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseErr) {
        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status} (${response.statusText}).`);
        }
        throw new Error('Received non-JSON response from server.');
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to analyze media link.');
      }

      currentMetadata = result.data;
      renderMetadata(currentMetadata);
      showToast('success', 'Media Detected', `Found formats for "${currentMetadata.title.substring(0, 45)}..."`);
    } catch (err) {
      console.error('Analysis error:', err);
      showToast('error', 'Analysis Failed', err.message);
    } finally {
      analysisLoader.classList.add('hidden');
      setAnalyzeButtonLoading(false);
    }
  }

  function renderMetadata(meta) {
    videoTitle.textContent = meta.title;
    videoUploader.innerHTML = `<i class="fa-solid fa-user-circle"></i> ${meta.uploader || 'Creator'}`;
    videoDuration.textContent = meta.durationFormatted || '0:00';
    platformBadge.innerHTML = `<i class="fa-solid fa-globe"></i> ${meta.platform || 'Web Stream'}`;

    if (meta.thumbnail) {
      videoThumb.src = meta.thumbnail;
      videoThumb.classList.remove('hidden');
    } else {
      videoThumb.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80';
    }

    // Default to video tab
    activeMediaType = 'video';
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');

    renderFormatOptions();
    previewCard.classList.remove('hidden');

    // Scroll to preview card smoothly
    previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ==========================================================================
     Format & Quality Rendering
     ========================================================================== */

  tabVideo.addEventListener('click', () => {
    activeMediaType = 'video';
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');
    renderFormatOptions();
  });

  tabAudio.addEventListener('click', () => {
    activeMediaType = 'audio';
    tabAudio.classList.add('active');
    tabVideo.classList.remove('active');
    renderFormatOptions();
  });

  function renderFormatOptions() {
    if (!currentMetadata || !currentMetadata.formats) return;

    const formats = currentMetadata.formats.filter(f => {
      if (activeMediaType === 'audio') return f.isAudioOnly;
      return !f.isAudioOnly;
    });

    if (formats.length === 0) {
      formatOptionsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center; color: var(--text-muted);">
          No ${activeMediaType} formats available for this media.
        </div>
      `;
      selectedFormat = null;
      selectedSizeEstimate.textContent = 'Estimated: --';
      return;
    }

    // Select first option by default
    selectedFormat = formats[0];
    updateSelectedSizeBadge();

    formatOptionsGrid.innerHTML = formats.map((f, index) => `
      <div class="format-card ${index === 0 ? 'selected' : ''}" data-index="${index}">
        <div class="format-top-row">
          <span class="format-quality">${f.quality}</span>
          ${f.tag ? `<span class="format-badge-pill">${f.tag}</span>` : ''}
        </div>
        <div class="format-meta-row">
          <span>${(f.ext || 'mp4').toUpperCase()}</span>
          <span class="format-size">${f.filesizeFormatted || 'Auto'}</span>
        </div>
      </div>
    `).join('');

    // Attach click listeners to cards
    const cards = formatOptionsGrid.querySelectorAll('.format-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const idx = parseInt(card.getAttribute('data-index'), 10);
        selectedFormat = formats[idx];
        updateSelectedSizeBadge();
      });
    });
  }

  function updateSelectedSizeBadge() {
    if (!selectedFormat) {
      selectedSizeEstimate.textContent = 'Estimated: --';
      downloadBtnText.textContent = 'Download Media';
      return;
    }

    selectedSizeEstimate.textContent = `Estimated: ${selectedFormat.filesizeFormatted || '-- MB'}`;
    downloadBtnText.textContent = `Download ${selectedFormat.quality} (${(selectedFormat.ext || 'MP4').toUpperCase()})`;
  }

  /* ==========================================================================
     Download Execution (POST /api/download & GET /api/progress/:jobId)
     ========================================================================== */

  startDownloadBtn.addEventListener('click', async () => {
    if (!currentMetadata || !selectedFormat) {
      showToast('error', 'Format Required', 'Please select a quality format to download.');
      return;
    }

    // Prepare job request payload
    const payload = {
      url: currentMetadata.webpage_url,
      title: currentMetadata.title,
      formatId: selectedFormat.formatId,
      ext: selectedFormat.ext,
      quality: selectedFormat.quality
    };

    try {
      startDownloadBtn.disabled = true;
      startDownloadBtn.style.opacity = '0.7';

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to start download process.');
      }

      activeJobId = result.jobId;
      startProgressMonitoring(activeJobId, payload);
    } catch (err) {
      console.error('Download init error:', err);
      showToast('error', 'Download Failed', err.message);
    } finally {
      startDownloadBtn.disabled = false;
      startDownloadBtn.style.opacity = '1';
    }
  });

  function startProgressMonitoring(jobId, metaPayload) {
    hideAllCards();
    progressCard.classList.remove('hidden');

    progressJobTitle.textContent = currentMetadata ? currentMetadata.title : 'Downloading media...';
    progressStatusDesc.textContent = 'Initializing secure stream...';
    progressBarFill.style.width = '0%';
    metricPercent.textContent = '0%';
    metricSpeed.textContent = 'Starting...';
    metricEta.textContent = '--:--';
    metricFormat.textContent = (metaPayload.ext || 'mp4').toUpperCase();

    // Scroll to progress card
    progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/progress/${jobId}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Progress tracking error.');
        }

        const job = data.job;

        if (job.status === 'downloading') {
          const pct = Math.max(0, Math.min(100, job.progress || 0));
          progressBarFill.style.width = `${pct}%`;
          metricPercent.textContent = `${pct}%`;
          metricSpeed.textContent = job.speed || '-- MB/s';
          metricEta.textContent = job.eta ? `ETA ${job.eta}` : '--:--';
          progressStatusDesc.textContent = `Streaming data (${job.speed || 'processing'})...`;
        } else if (job.status === 'completed') {
          clearInterval(progressInterval);
          progressBarFill.style.width = '100%';
          metricPercent.textContent = '100%';

          // Save to history
          HistoryManager.saveDownload({
            jobId: job.id,
            title: currentMetadata ? currentMetadata.title : job.fileName,
            thumbnail: currentMetadata ? currentMetadata.thumbnail : '',
            url: currentMetadata ? currentMetadata.webpage_url : '',
            quality: metaPayload.quality,
            ext: job.ext,
            filesizeFormatted: job.fileSizeFormatted
          });

          // Show success
          showDownloadSuccess(job);
        } else if (job.status === 'failed') {
          clearInterval(progressInterval);
          hideAllCards();
          previewCard.classList.remove('hidden');
          showToast('error', 'Download Failed', job.error || 'Failed to download file from source.');
        } else if (job.status === 'cancelled') {
          clearInterval(progressInterval);
          hideAllCards();
          previewCard.classList.remove('hidden');
          showToast('info', 'Download Cancelled', 'The download task was cancelled.');
        }
      } catch (e) {
        console.warn('Progress check error:', e);
      }
    }, 600);
  }

  function showDownloadSuccess(job) {
    hideAllCards();
    successCard.classList.remove('hidden');

    const downloadUrl = `/api/file/${job.id}?download=1`;
    successFilename.textContent = `${job.fileName} • ${job.fileSizeFormatted}`;
    successSaveBtn.href = downloadUrl;

    // Trigger auto-download to save directly to user's device
    const hiddenLink = document.createElement('a');
    hiddenLink.href = downloadUrl;
    hiddenLink.setAttribute('download', job.fileName);
    document.body.appendChild(hiddenLink);
    hiddenLink.click();
    document.body.removeChild(hiddenLink);

    showToast('success', 'Download Ready!', `Saved "${job.fileName}" to your device.`);

    // Browser play button
    successPlayBtn.onclick = () => {
      openModalPlayer(`/api/file/${job.id}`, job.fileName);
    };
  }

  // Cancel Download Button
  cancelDownloadBtn.addEventListener('click', async () => {
    if (!activeJobId) return;

    try {
      await fetch(`/api/cancel/${activeJobId}`, { method: 'POST' });
      if (progressInterval) clearInterval(progressInterval);
      hideAllCards();
      previewCard.classList.remove('hidden');
      showToast('info', 'Download Cancelled', 'Process has been stopped.');
    } catch (e) {
      console.error('Cancel error:', e);
    }
  });

  // Download Another Button
  downloadAnotherBtn.addEventListener('click', () => {
    hideAllCards();
    urlInput.value = '';
    clearInputBtn.classList.add('hidden');
    urlInput.focus();
  });

  /* ==========================================================================
     Modal Video Player
     ========================================================================== */

  previewPlayBtn.addEventListener('click', () => {
    if (currentMetadata && currentMetadata.webpage_url) {
      // If direct media url or we can preview
      if (currentMetadata.webpage_url.match(/\.(mp4|webm|mov)($|\?)/i)) {
        openModalPlayer(currentMetadata.webpage_url, currentMetadata.title);
      } else {
        showToast('info', 'Web Stream', 'Click Download to save and stream this content offline.');
      }
    }
  });

  function openModalPlayer(src, title) {
    modalPlayerTitle.textContent = title || 'Video Player';
    modalVideoElement.src = src;
    videoPlayerModal.classList.remove('hidden');
    modalVideoElement.play().catch(() => {});
  }

  closeModalBtn.addEventListener('click', () => {
    modalVideoElement.pause();
    modalVideoElement.src = '';
    videoPlayerModal.classList.add('hidden');
  });

  videoPlayerModal.addEventListener('click', (e) => {
    if (e.target === videoPlayerModal) {
      modalVideoElement.pause();
      modalVideoElement.src = '';
      videoPlayerModal.classList.add('hidden');
    }
  });

  /* ==========================================================================
     History Drawer Handling
     ========================================================================== */

  historyToggleBtn.addEventListener('click', () => {
    HistoryManager.render(historyList, (url) => {
      closeHistoryDrawer();
      urlInput.value = url;
      clearInputBtn.classList.remove('hidden');
      analyzeUrl(url);
    });
    historyDrawer.classList.add('open');
  });

  function closeHistoryDrawer() {
    historyDrawer.classList.remove('open');
  }

  closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
  drawerBackdrop.addEventListener('click', closeHistoryDrawer);

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear your entire download history?')) {
      HistoryManager.clearAll();
      HistoryManager.render(historyList);
      showToast('info', 'History Cleared', 'Download history removed.');
    }
  });

  /* ==========================================================================
     UI Utilities & Toast Notifications
     ========================================================================== */

  function hideAllCards() {
    previewCard.classList.add('hidden');
    progressCard.classList.add('hidden');
    successCard.classList.add('hidden');
    analysisLoader.classList.add('hidden');
  }

  function setAnalyzeButtonLoading(isLoading) {
    const label = analyzeBtn.querySelector('.btn-label');
    const spinner = analyzeBtn.querySelector('.spinner');

    if (isLoading) {
      label.classList.add('hidden');
      spinner.classList.remove('hidden');
      analyzeBtn.disabled = true;
    } else {
      label.classList.remove('hidden');
      spinner.classList.add('hidden');
      analyzeBtn.disabled = false;
    }
  }

  function showToast(type, title, message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-triangle-exclamation';
    if (type === 'warning') iconClass = 'fa-circle-exclamation';

    toast.innerHTML = `
      <i class="fa-solid ${iconClass} toast-icon"></i>
      <div class="toast-msg-wrap">
        <div class="toast-title">${title}</div>
        <div class="toast-desc">${message}</div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'all 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 4500);
  }

  window.showToast = showToast;
});
