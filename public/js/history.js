/**
 * History Manager for AURA Universal Video Downloader
 * Persists downloaded media records to localStorage and handles UI updates.
 */
const STORAGE_KEY = 'aura_download_history_v1';

const HistoryManager = {
  getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to read history from localStorage:', e);
      return [];
    }
  },

  saveDownload(item) {
    try {
      const history = this.getHistory();
      // Prepend to top
      const record = {
        id: item.id || `hist_${Date.now()}`,
        jobId: item.jobId || null,
        title: item.title || 'Untitled Media',
        thumbnail: item.thumbnail || '',
        url: item.url || '',
        quality: item.quality || 'HD',
        format: (item.ext || 'mp4').toUpperCase(),
        filesizeFormatted: item.filesizeFormatted || 'Downloaded',
        timestamp: Date.now(),
        dateFormatted: new Date().toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };

      // Filter duplicate if already exists with same jobId or title & timestamp
      const filtered = history.filter(h => h.id !== record.id);
      filtered.unshift(record);

      // Keep max 50 items
      const trimmed = filtered.slice(0, 50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      this.updateBadge();
      return record;
    } catch (e) {
      console.error('Failed to save to history:', e);
      return null;
    }
  },

  deleteItem(id) {
    try {
      const history = this.getHistory();
      const updated = history.filter(item => item.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      this.updateBadge();
      return true;
    } catch (e) {
      console.error('Failed to delete history item:', e);
      return false;
    }
  },

  clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.updateBadge();
      return true;
    } catch (e) {
      console.error('Failed to clear history:', e);
      return false;
    }
  },

  updateBadge() {
    const badge = document.getElementById('history-badge');
    if (!badge) return;
    const count = this.getHistory().length;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  render(containerElement, onSelectUrl) {
    if (!containerElement) return;
    const history = this.getHistory();
    const emptyState = document.getElementById('empty-history-state');

    if (history.length === 0) {
      containerElement.innerHTML = '';
      if (emptyState) {
        containerElement.appendChild(emptyState);
        emptyState.classList.remove('hidden');
      }
      return;
    }

    if (emptyState) {
      emptyState.classList.add('hidden');
    }

    containerElement.innerHTML = history.map(item => `
      <div class="history-item-card" data-id="${item.id}">
        <div class="history-thumb-wrap">
          <img src="${item.thumbnail || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80'}" alt="Thumbnail" class="history-thumb-img" onerror="this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80'">
        </div>
        <div class="history-info">
          <div class="history-item-title" title="${item.title}">${item.title}</div>
          <div class="history-item-meta">
            <span>${item.quality} • ${item.format}</span>
            <span>• ${item.filesizeFormatted}</span>
          </div>
          <div class="history-item-meta" style="font-size: 0.7rem; color: #717182;">
            ${item.dateFormatted}
          </div>
          <div class="history-item-actions">
            ${item.jobId ? `
              <a href="/api/file/${item.jobId}?download=1" class="history-btn-small" download>
                <i class="fa-solid fa-download"></i> Save
              </a>
              <button type="button" class="history-btn-small btn-hist-preview" data-jobid="${item.jobId}" data-title="${encodeURIComponent(item.title)}">
                <i class="fa-solid fa-play"></i>
              </button>
            ` : `
              <button type="button" class="history-btn-small btn-hist-reanalyze" data-url="${encodeURIComponent(item.url)}">
                <i class="fa-solid fa-rotate-right"></i> Re-Analyze
              </button>
            `}
            <button type="button" class="btn-del-history" data-id="${item.id}" title="Delete item">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    // Attach event listeners
    containerElement.querySelectorAll('.btn-del-history').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        HistoryManager.deleteItem(id);
        HistoryManager.render(containerElement, onSelectUrl);
      });
    });

    containerElement.querySelectorAll('.btn-hist-reanalyze').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = decodeURIComponent(e.currentTarget.getAttribute('data-url'));
        if (onSelectUrl) onSelectUrl(url);
      });
    });

    containerElement.querySelectorAll('.btn-hist-preview').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const jobId = e.currentTarget.getAttribute('data-jobid');
        const title = decodeURIComponent(e.currentTarget.getAttribute('data-title'));
        const modal = document.getElementById('video-player-modal');
        const player = document.getElementById('modal-video-element');
        const modalTitle = document.getElementById('modal-player-title');

        if (modal && player) {
          modalTitle.textContent = title;
          player.src = `/api/file/${jobId}`;
          modal.classList.remove('hidden');
          player.play().catch(() => {});
        }
      });
    });
  }
};

window.HistoryManager = HistoryManager;
