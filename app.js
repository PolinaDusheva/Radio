// RadioWave PWA - Main Application
class RadioWaveApp {
    constructor() {
        this.currentStation = null;
        this.audioElement = document.getElementById('audioElement');
        this.isPlaying = false;
        this.favorites = JSON.parse(localStorage.getItem('radiowave_favorites') || '[]');
        this.myMusic = JSON.parse(localStorage.getItem('radiowave_music') || '[]');
        // Load volume from localStorage, default to 50 if not found
        this.volume = parseInt(localStorage.getItem('radiowave_volume') || '50', 10);
        this.stations = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.isLandscape = false;
        this.landscapeTimeout = null;
        this.currentMusic = null;
        this.systemVolumeSupported = false;
        this.isOnline = navigator.onLine;
        
        // File system related properties
        this.musicFolderHandle = null;
        this.hasFileSystemAccess = false;
        this.musicFolderName = 'RadioWave_Music';
        
        // Radio Browser API servers - multiple for fallbacks
        this.apiServers = [
            'https://de1.api.radio-browser.info',
            'https://at1.api.radio-browser.info',
            'https://nl1.api.radio-browser.info',
            'https://fr1.api.radio-browser.info'
        ];
        this.apiBase = this.apiServers[0]; // Default to first server
        this.apiRetryCount = 0;
        
        this.audioContext = null;
        this.debounceTimer = null;
        
        // Audio preloading
        this.preloadedStations = new Map();
        this.preloadLimit = 5; // Maximum number of stations to preload
        this.playAttempts = 0; // Track play attempts for fallbacks
        this.maxPlayAttempts = 3; // Maximum attempts before showing error
        
        // Create secondary audio element for preloading
        this.preloadAudio = new Audio();
        
        this.init();
    }

    async init() {
        console.log('Initializing RadioWave App');
        
        this.setupEventListeners();
        this.setupOrientationHandling();
        this.setupServiceWorker();
        this.setupNetworkDetection();
        
        // Check online status
        this.isOnline = navigator.onLine;
        
        // Check URL for section parameter (used by PWA shortcuts)
        const urlParams = new URLSearchParams(window.location.search);
        const sectionParam = urlParams.get('section');
        
        // Render necessary UI elements regardless of online status
        this.renderFavorites();
        this.checkFileSystemAccess();
        this.renderMyMusic();
        
        // Set initial volume based on loaded value
        this.setVolume(this.volume);
        this.updatePlayerState();
        this.checkOrientation();
        
        // Setup media session for controlling system media
        this.setupMediaSession();
        
        // Switch to the section specified in URL, if any
        if (sectionParam && ['radio', 'favorites', 'my-music'].includes(sectionParam)) {
            console.log(`Loading section from URL: ${sectionParam}`);
            
            // If offline and trying to access radio, show My Music instead
            if (!this.isOnline && sectionParam === 'radio') {
                console.log('App starting in offline mode - showing My Music instead of Radio');
                setTimeout(() => {
                    this.switchSection('my-music');
                }, 100);
            } else {
                setTimeout(() => {
                    this.switchSection(sectionParam);
                }, 100);
            }
        }
        // Otherwise check online status
        else if (!this.isOnline) {
            console.log('App starting in offline mode - showing My Music');
            // Give a brief delay to allow UI to render first
            setTimeout(() => {
                this.switchSection('my-music');
            }, 100);
        } else {
            // Only load stations when online
            await this.loadStations();
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                
                // If offline and trying to access radio section, show warning
                if (!this.isOnline && section === 'radio') {
                    this.showError('You are offline. Radio stations are not available.');
                    return;
                }
                
                this.switchSection(section);
            });
        });

        // "All" filter button
        document.querySelector('.filter-btn[data-filter="all"]').addEventListener('click', () => {
            this.loadStations();
        });

        // Search
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.debounce(() => this.filterStations(), 300);
        });

        // Top player controls
        document.getElementById('topPlayPauseBtn').addEventListener('click', () => {
            this.togglePlayPause();
        });

        document.getElementById('topPrevBtn').addEventListener('click', () => {
            this.playPrevious();
        });

        document.getElementById('topNextBtn').addEventListener('click', () => {
            this.playNext();
        });

        // Landscape extras controls
        document.getElementById('favoriteBtn').addEventListener('click', () => {
            this.toggleFavorite();
        });

        document.getElementById('volumeBtn').addEventListener('click', () => {
            this.toggleVolumeModal();
        });

        // Volume control
        const volumeSlider = document.getElementById('volumeSlider');
        volumeSlider.addEventListener('input', (e) => {
            this.setVolume(e.target.value);
        });

        // Upload functionality
        document.getElementById('uploadBtn').addEventListener('click', () => {
            this.showUploadModal();
        });

        // File upload
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.getElementById('uploadArea');
        
        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--primary-color)';
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.borderColor = 'var(--border-color)';
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--border-color)';
            this.handleFileUpload(e);
        });

        // Modal close handlers
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').classList.remove('show');
            });
        });

        // Close modals when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
            });
        });

        // Audio element events
        this.audioElement.addEventListener('loadstart', () => this.showLoading());
        this.audioElement.addEventListener('canplay', () => this.hideLoading());
        this.audioElement.addEventListener('error', () => this.handleAudioError());
        this.audioElement.addEventListener('ended', () => this.playNext());

        // Landscape player controls
        document.getElementById('landscapePlayPauseBtn').addEventListener('click', () => {
            this.togglePlayPause();
        });

        document.getElementById('landscapePrevBtn').addEventListener('click', () => {
            this.playPrevious();
        });

        document.getElementById('landscapeNextBtn').addEventListener('click', () => {
            this.playNext();
        });

        // Landscape favorite button
        document.getElementById('landscapeFavoriteBtn').addEventListener('click', () => {
            this.toggleFavorite();
        });

        // Landscape volume button
        document.getElementById('landscapeVolumeBtn')?.addEventListener('click', () => {
            this.toggleVolumeModal();
        });

        // Landscape volume slider
        const landscapeVolumeSlider = document.getElementById('landscapeVolumeSlider');
        if (landscapeVolumeSlider) {
            landscapeVolumeSlider.addEventListener('input', (e) => {
                this.setVolume(e.target.value);
            });
        }

        // Landscape navigation
        document.querySelectorAll('.landscape-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                
                if (section === 'upload') {
                    this.showUploadModal();
                } else {
                    // If offline and trying to access radio section, show warning
                    if (!this.isOnline && section === 'radio') {
                        this.showError('You are offline. Radio stations are not available.');
                        return;
                    }
                    
                    this.switchSection(section);
                    this.updateLandscapeNav();
                }
            });
        });
    }

    async setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                // Try relative path first for GitHub Pages compatibility
                const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
                console.log('Service Worker registered successfully', registration.scope);
                
                // Handle updates to the service worker
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('New service worker installing...');
                    
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker available
                            console.log('New service worker installed and ready to take over');
                            this.showUpdateAvailableMessage();
                        }
                    });
                });
                
                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', (event) => {
                    if (event.data && event.data.type === 'RELOAD_PAGE') {
                        window.location.reload();
                    }
                });
                
                // Check if there's an update on startup
                if (registration.waiting) {
                    this.showUpdateAvailableMessage();
                }
            } catch (error) {
                console.log('Service Worker registration failed:', error);
                // Fallback to absolute path
                try {
                    await navigator.serviceWorker.register('/sw.js');
                    console.log('Service Worker registered with fallback path');
                } catch (fallbackError) {
                    console.log('Service Worker registration completely failed:', fallbackError);
                }
            }
        }
    }
    
    showUpdateAvailableMessage() {
        const updateToast = document.createElement('div');
        updateToast.className = 'update-toast';
        updateToast.innerHTML = `
            <div class="update-message">New version available</div>
            <button class="update-button">Update Now</button>
        `;
        
        // Add to body
        document.body.appendChild(updateToast);
        
        // Show with animation
        setTimeout(() => {
            updateToast.classList.add('show');
        }, 10);
        
        // Update button handler
        updateToast.querySelector('.update-button').addEventListener('click', () => {
            // Hide the toast
            updateToast.classList.remove('show');
            
            // Tell service worker to skipWaiting
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
                
                // Force reload to activate the new service worker
                window.location.reload();
            }
        });
    }

    async loadStations() {
        // Don't try to load stations when offline
        if (!this.isOnline) {
            console.log('Offline: Not loading stations');
            document.getElementById('stations-grid').innerHTML = `
                <div class="offline-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>You're offline</h3>
                    <p>Radio stations are not available without an internet connection.</p>
                    <p>Switch to My Music to listen to your uploaded songs.</p>
                </div>
            `;
            return;
        }
        
        this.showLoading();
        try {
            // Load popular stations first
            const response = await fetch(`${this.apiBase}/json/stations/topvote/100`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.stations = await response.json();
            this.renderStations();
            this.apiRetryCount = 0; // Reset retry count on success
            
            // Preload top 5 stations for faster initial playback
            this.preloadTopStations();
        } catch (error) {
            console.error('Failed to load stations:', error);
            
            // Try next API server if available
            if (this.apiRetryCount < this.apiServers.length - 1) {
                this.apiRetryCount++;
                this.apiBase = this.apiServers[this.apiRetryCount];
                console.log(`Trying alternate API server: ${this.apiBase}`);
                return this.loadStations(); // Retry with new server
            }
            
            // All servers failed
            this.showError('Failed to load radio stations. Please check your connection and try again.');
        }
        this.hideLoading();
    }

    preloadTopStations() {
        // Clear existing preloads first
        this.preloadedStations.clear();
        
        // Only preload top N stations to save resources
        const stationsToPreload = this.stations.slice(0, this.preloadLimit);
        
        stationsToPreload.forEach(station => {
            this.preloadStation(station);
        });
    }
    
    preloadStation(station) {
        if (!station || !station.url) return;
        
        const stationId = station.stationuuid || station.uuid;
        if (!stationId) return;
        
        // Skip if already preloaded
        if (this.preloadedStations.has(stationId)) return;
        
        // Create an object to track preload status
        const preloadInfo = {
            url: station.url,
            urlResolved: station.url_resolved,
            status: 'pending',
            audio: null
        };
        
        this.preloadedStations.set(stationId, preloadInfo);
        
        // Start preloading in background
        setTimeout(() => {
            // Use fetch with HEAD request to check if stream is accessible
            fetch(station.url, { method: 'HEAD', mode: 'no-cors' })
                .then(() => {
                    preloadInfo.status = 'ready';
                })
                .catch(() => {
                    // Try alternate URL if available
                    if (station.url_resolved && station.url_resolved !== station.url) {
                        fetch(station.url_resolved, { method: 'HEAD', mode: 'no-cors' })
                            .then(() => {
                                preloadInfo.status = 'ready';
                                preloadInfo.preferResolved = true;
                            })
                            .catch(() => {
                                preloadInfo.status = 'error';
                            });
                    } else {
                        preloadInfo.status = 'error';
                    }
                });
        }, 0);
    }

    async searchStations(query) {
        if (!query) {
            await this.loadStations();
            return;
        }

        this.showLoading();
        try {
            const response = await fetch(
                `${this.apiBase}/json/stations/search?name=${encodeURIComponent(query)}&limit=50`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.stations = await response.json();
            this.renderStations();
            this.apiRetryCount = 0; // Reset retry count on success
        } catch (error) {
            console.error('Search failed:', error);
            
            // Try next API server if available
            if (this.apiRetryCount < this.apiServers.length - 1) {
                this.apiRetryCount++;
                this.apiBase = this.apiServers[this.apiRetryCount];
                console.log(`Trying alternate API server for search: ${this.apiBase}`);
                return this.searchStations(query); // Retry with new server
            }
            
            this.showError('Search failed. Please try again or check your connection.');
        }
        this.hideLoading();
    }

    async loadStationsByFilter(filter) {
        this.showLoading();
        try {
            let endpoint;
            switch (filter) {
                case 'popular':
                    endpoint = 'topvote/100';
                    break;
                case 'country':
                    // Get stations by user's country (fallback to US)
                    const country = await this.getUserCountry();
                    endpoint = `search?countrycode=${country}&limit=100`;
                    break;
                case 'genre':
                    endpoint = 'search?tag=pop,rock,jazz&limit=100';
                    break;
                default:
                    endpoint = 'topvote/100';
            }
            
            const response = await fetch(`${this.apiBase}/json/stations/${endpoint}`);
            this.stations = await response.json();
            this.renderStations();
        } catch (error) {
            console.error('Failed to load filtered stations:', error);
            await this.loadStations(); // Fallback
        }
        this.hideLoading();
    }

    async getUserCountry() {
        try {
            const response = await fetch('https://ipapi.co/json/');
            const data = await response.json();
            return data.country_code || 'US';
        } catch {
            return 'US';
        }
    }

    renderStations() {
        const grid = document.getElementById('stations-grid');
        if (!this.stations || this.stations.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-radio"></i>
                    <h3>No stations found</h3>
                    <p>Try adjusting your search or filter</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.stations.map(station => this.createStationCard(station)).join('');
        
        // Add click listeners to station cards
        document.querySelectorAll('.station-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.station-actions')) {
                    const stationId = card.dataset.stationId;
                    const station = this.stations.find(s => 
                        (s.stationuuid && s.stationuuid === stationId) || 
                        (s.uuid && s.uuid === stationId)
                    );
                    
                    if (station) {
                        this.playStation(station);
                    } else {
                        console.error('Station not found:', stationId);
                    }
                }
            });
        });

        // Add listeners to action buttons
        document.querySelectorAll('.play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const stationId = btn.closest('.station-card').dataset.stationId;
                const station = this.stations.find(s => 
                    (s.stationuuid && s.stationuuid === stationId) || 
                    (s.uuid && s.uuid === stationId)
                );
                
                if (!station) {
                    console.error('Station not found:', stationId);
                    return;
                }
                
                // Check if this is the current station and toggle play/pause instead of just playing
                if (this.currentStation) {
                    const sameStation = (
                        (station.stationuuid && this.currentStation.stationuuid && 
                         station.stationuuid === this.currentStation.stationuuid) ||
                        (station.uuid && this.currentStation.uuid && 
                         station.uuid === this.currentStation.uuid)
                    );
                    
                    if (sameStation) {
                        this.togglePlayPause();
                        return;
                    }
                }
                
                this.playStation(station);
            });
        });

        document.querySelectorAll('.favorite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const stationId = btn.closest('.station-card').dataset.stationId;
                const station = this.stations.find(s => 
                    (s.stationuuid && s.stationuuid === stationId) || 
                    (s.uuid && s.uuid === stationId)
                );
                
                if (station) {
                    this.toggleStationFavorite(station);
                } else {
                    console.error('Station not found:', stationId);
                }
            });
        });
    }

    createStationCard(station) {
        // Determine station ID (use stationuuid or uuid)
        const stationId = station.stationuuid || station.uuid;
        
        if (!stationId) {
            console.error('Missing station ID in createStationCard:', station);
        }
        
        // Check if station is in favorites
        const isFavorite = this.favorites.some(fav => 
            (fav.stationuuid && station.stationuuid && fav.stationuuid === station.stationuuid) || 
            (fav.uuid && station.uuid && fav.uuid === station.uuid)
        );
        
        // Check if station is currently playing
        const isActive = this.currentStation && (
            (this.currentStation.stationuuid && station.stationuuid && 
             this.currentStation.stationuuid === station.stationuuid) ||
            (this.currentStation.uuid && station.uuid && 
             this.currentStation.uuid === station.uuid)
        );
        
        // Optimize image loading with loading="lazy" and use placeholders
        const stationImage = station.favicon ? 
            `<img src="${station.favicon}" alt="${station.name}" loading="lazy" onerror="this.onerror=null; this.innerHTML='<i class=\'fas fa-radio\'></i>'" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">` : 
            '<i class="fas fa-radio"></i>';
        
        // Ensure station name is available and not too long
        const stationName = station.name || 'Unknown Station';
        
        return `
            <div class="station-card ${isActive ? 'active' : ''}" data-station-id="${stationId}">
                <div class="station-info">
                    <div class="station-avatar">
                        ${stationImage}
                    </div>
                    <div class="station-details">
                        <h3 title="${stationName}">${stationName}</h3>
                    </div>
                    <div class="station-actions">
                        <button class="play-btn" title="${isActive && this.isPlaying ? 'Pause' : 'Play'}">
                            <i class="fas ${isActive && this.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button class="favorite-btn ${isFavorite ? 'active' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                            <i class="fas fa-heart"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    renderFavorites() {
        const grid = document.getElementById('favorites-grid');
        if (this.favorites.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-heart"></i>
                    <h3>No favorites yet</h3>
                    <p>Add stations to your favorites to see them here</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.favorites.map(station => this.createStationCard(station)).join('');
        this.addStationCardListeners();
    }

    renderMyMusic() {
        const grid = document.getElementById('my-music-grid');
        
        if (!grid) {
            console.error('My Music grid element not found');
            return;
        }
        
        if (this.myMusic.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-music"></i>
                    <h3>No songs uploaded</h3>
                    <p>Upload your music to listen offline</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.myMusic.map(song => this.createMusicCard(song)).join('');
        this.addMusicCardListeners();
    }

    createMusicCard(song) {
        // Ensure IDs are compared as strings
        const isActive = this.currentStation && String(this.currentStation.id) === String(song.id);
        
        return `
            <div class="station-card ${isActive ? 'active' : ''}" data-song-id="${String(song.id)}">
                <div class="station-info">
                    <div class="station-avatar">
                        <i class="fas fa-music"></i>
                    </div>
                    <div class="station-details">
                        <h3 title="${song.name}">${song.name}</h3>
                    </div>
                    <div class="station-actions">
                        <button class="play-btn" title="${isActive && this.isPlaying ? 'Pause' : 'Play'}">
                            <i class="fas ${isActive && this.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button class="delete-btn" title="Delete song">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    addStationCardListeners() {
        document.querySelectorAll('#favorites-grid .station-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.station-actions')) {
                    const stationId = card.dataset.stationId;
                    const station = this.favorites.find(s => 
                        (s.stationuuid && s.stationuuid === stationId) || 
                        (s.uuid && s.uuid === stationId)
                    );
                    
                    if (station) {
                        this.playStation(station);
                    } else {
                        console.error('Favorite station not found:', stationId);
                    }
                }
            });
        });

        document.querySelectorAll('#favorites-grid .play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const stationId = btn.closest('.station-card').dataset.stationId;
                const station = this.favorites.find(s => 
                    (s.stationuuid && s.stationuuid === stationId) || 
                    (s.uuid && s.uuid === stationId)
                );
                
                if (!station) {
                    console.error('Favorite station not found:', stationId);
                    return;
                }
                
                // Check if this is the current station and toggle play/pause instead of just playing
                if (this.currentStation) {
                    const sameStation = (
                        (station.stationuuid && this.currentStation.stationuuid && 
                         station.stationuuid === this.currentStation.stationuuid) ||
                        (station.uuid && this.currentStation.uuid && 
                         station.uuid === this.currentStation.uuid)
                    );
                    
                    if (sameStation) {
                        this.togglePlayPause();
                        return;
                    }
                }
                
                this.playStation(station);
            });
        });
    }

    addMusicCardListeners() {
        document.querySelectorAll('#my-music-grid .station-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.station-actions')) {
                    const songId = card.dataset.songId;
                    const song = this.myMusic.find(s => s.id === songId);
                    if (song) {
                        this.playLocalMusic(song);
                    } else {
                        console.error('Song not found:', songId);
                    }
                }
            });
        });

        document.querySelectorAll('#my-music-grid .play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const songId = btn.closest('.station-card').dataset.songId;
                const song = this.myMusic.find(s => s.id === songId);
                
                if (!song) {
                    console.error('Song not found:', songId);
                    return;
                }
                
                // Check if this is the current song and toggle play/pause instead of just playing
                if (this.currentStation && this.currentStation.id === song.id) {
                    this.togglePlayPause();
                } else {
                    this.playLocalMusic(song);
                }
            });
        });

        document.querySelectorAll('#my-music-grid .delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const songId = btn.closest('.station-card').dataset.songId;
                this.deleteLocalMusic(songId);
            });
        });
    }

    async playStation(station) {
        console.log('Playing station:', station.name);
        
        // Reset play attempts counter
        this.playAttempts = 0;
        
        // Check if this station is already playing
        if (this.currentStation && this.isPlaying) {
            // Check both uuid and stationuuid fields
            const sameStation = (
                (station.stationuuid && this.currentStation.stationuuid && 
                 station.stationuuid === this.currentStation.stationuuid) ||
                (station.uuid && this.currentStation.uuid && 
                 station.uuid === this.currentStation.uuid)
            );
            
            if (sameStation) {
                // If it's the same station and it's already playing, pause it
                this.togglePlayPause();
                return;
            }
        }
        
        // Show loading indicator
        this.showLoading();
        
        try {
            // Reset audio element
            this.audioElement.pause();
            this.audioElement.removeAttribute('src');
            this.audioElement.load();
            
            // Clear any previous errors
            this.audioElement.onerror = null;
            
            // Make sure both uuid and stationuuid are set if available
            const stationId = station.uuid || station.stationuuid;
            if (station.uuid && !station.stationuuid) {
                station.stationuuid = station.uuid;
            } else if (station.stationuuid && !station.uuid) {
                station.uuid = station.stationuuid;
            }
            
            // Update current station
            this.currentStation = station;
            this.currentStation.type = 'radio'; // Explicitly set type
            this.currentMusic = null;
            
            // Check if we've preloaded this station
            const preloadInfo = this.preloadedStations.get(stationId);
            
            // Configure audio element for low latency
            this.audioElement.crossOrigin = "anonymous";
            this.audioElement.preload = "auto";
            
            // Set a shorter audio buffer for faster startup
            if (this.audioContext) {
                try {
                    // Attempt to reduce latency where supported
                    if (this.audioContext.baseLatency !== undefined) {
                        console.log('Using low latency audio mode');
                    }
                } catch (e) {
                    // Ignore if not supported
                }
            }
            
            // Set timeout for stalled connections - shorter for better UX
            const playbackTimeout = setTimeout(() => {
                if (!this.isPlaying) {
                    console.log('Playback timed out, trying alternative URL');
                    this.tryAlternativeUrl(station);
                }
            }, 5000); // 5 second timeout (reduced from 10s)
            
            // Setup error handler
            this.setupAudioErrorHandling(station, playbackTimeout);
            
            // Determine which URL to use first based on preload info
            let primaryUrl = station.url;
            let fallbackUrl = station.url_resolved;
            
            if (preloadInfo && preloadInfo.status === 'ready' && preloadInfo.preferResolved) {
                // Swap URLs if preloading found resolved URL works better
                primaryUrl = station.url_resolved;
                fallbackUrl = station.url;
            }
            
            // Set the source and play
            this.audioElement.src = primaryUrl;
            
            // Try to initiate playback faster by setting src and calling load before play
            this.audioElement.load();
            
            console.log('Starting playback with URL:', primaryUrl);
            
            // Track station play - wrapped in try/catch to avoid failure
            try {
                // Try both uuid and stationuuid
                this.countStationClick(station.stationuuid || station.uuid);
            } catch (clickError) {
                console.log('Failed to count click:', clickError);
            }
            
            // Start playing
            const playPromise = this.audioElement.play();
            
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    clearTimeout(playbackTimeout);
                    this.isPlaying = true;
                    this.updatePlayerState();
                    this.updateMediaSession(); // Update media session with current station
                    this.hideLoading();
                    
                    // Preload next station for faster switching
                    this.preloadNextStation();
                }).catch(error => {
                    clearTimeout(playbackTimeout);
                    console.error('Error playing audio:', error);
                    
                    // Try alternative URL if available
                    this.tryAlternativeUrl(station);
                });
            }
        } catch (error) {
            console.error('Error setting up audio:', error);
            this.handleAudioError();
        }
    }
    
    setupAudioErrorHandling(station, playbackTimeout) {
        // Add error event listener
        this.audioElement.onerror = (e) => {
            clearTimeout(playbackTimeout);
            console.error('Audio element error:', e);
            
            this.tryAlternativeUrl(station);
        };
        
        // Add stalled event listener for streams that hang
        this.audioElement.onstalled = () => {
            console.log('Playback stalled, attempting recovery');
            
            // If already playing, don't interrupt, just try to recover
            if (this.isPlaying) {
                // Try to recover without showing error
                this.audioElement.load();
                this.audioElement.play().catch(error => {
                    console.error('Stall recovery failed:', error);
                });
            } else {
                this.tryAlternativeUrl(station);
            }
        };
    }
    
    tryAlternativeUrl(station) {
        this.playAttempts++;
        
        // If we've tried too many times, show error
        if (this.playAttempts >= this.maxPlayAttempts) {
            this.handleAudioError();
            return;
        }
        
        // Use a race approach - try both URLs simultaneously and use the first one that works
        if (station.url && station.url_resolved && station.url !== station.url_resolved) {
            console.log('Trying both URLs in parallel for faster loading');
            
            // Create temporary audio elements to test both streams
            const audioTest1 = new Audio();
            const audioTest2 = new Audio();
            
            // Set a short timeout for each test
            const timeout = 3000;
            let resolved = false;
            
            // Promise-based race to see which URL loads faster
            Promise.race([
                // Try the first URL
                new Promise((resolve, reject) => {
                    audioTest1.src = station.url;
                    
                    // Set event handlers
                    audioTest1.oncanplay = () => resolve({ url: station.url, element: audioTest1 });
                    audioTest1.onerror = () => reject(new Error('First URL failed'));
                    
                    // Set timeout
                    setTimeout(() => reject(new Error('First URL timeout')), timeout);
                    
                    // Start loading
                    audioTest1.load();
                }),
                
                // Try the second URL
                new Promise((resolve, reject) => {
                    audioTest2.src = station.url_resolved;
                    
                    // Set event handlers
                    audioTest2.oncanplay = () => resolve({ url: station.url_resolved, element: audioTest2 });
                    audioTest2.onerror = () => reject(new Error('Second URL failed'));
                    
                    // Set timeout
                    setTimeout(() => reject(new Error('Second URL timeout')), timeout);
                    
                    // Start loading
                    audioTest2.load();
                })
            ])
            .then(result => {
                if (resolved) return;
                resolved = true;
                
                console.log('Parallel loading succeeded with URL:', result.url);
                
                // Clean up test elements
                audioTest1.src = '';
                audioTest2.src = '';
                
                // Use the successful URL
                this.audioElement.src = result.url;
                this.audioElement.load();
                return this.audioElement.play();
            })
            .then(() => {
                this.isPlaying = true;
                this.updatePlayerState();
                this.hideLoading();
            })
            .catch(error => {
                console.error('Parallel loading failed:', error);
                
                // Fall back to sequential approach if parallel fails
                if (!resolved) {
                    resolved = true;
                    this.trySequentialUrls(station);
                }
            });
            
            return;
        }
        
        // If we only have one URL or they're the same, use sequential approach
        this.trySequentialUrls(station);
    }
    
    trySequentialUrls(station) {
        // Try resolved URL if it exists and is different
        if (station.url_resolved && station.url_resolved !== this.audioElement.src) {
            console.log('Trying alternative URL:', station.url_resolved);
            this.audioElement.src = station.url_resolved;
            this.audioElement.load();
            this.audioElement.play().catch(error => {
                console.error('Error playing alternative URL:', error);
                
                // Try original URL if different from current and resolved
                if (station.url && station.url !== station.url_resolved && station.url !== this.audioElement.src) {
                    console.log('Trying original URL:', station.url);
                    this.audioElement.src = station.url;
                    this.audioElement.load();
                    this.audioElement.play().catch(finalError => {
                        console.error('Error playing original URL:', finalError);
                        this.handleAudioError();
                    });
                } else {
                    this.handleAudioError();
                }
            });
            return;
        }
        
        // Try original URL if it exists and is different
        if (station.url && station.url !== this.audioElement.src) {
            console.log('Trying original URL:', station.url);
            this.audioElement.src = station.url;
            this.audioElement.load();
            this.audioElement.play().catch(error => {
                console.error('Error playing original URL:', error);
                this.handleAudioError();
            });
            return;
        }
        
        // If we get here, we've tried all URLs or they're all the same, show error
        this.handleAudioError();
    }
    
    preloadNextStation() {
        // Get current list of stations
        const currentList = this.getCurrentPlaylist();
        if (currentList.length === 0) return;

        let currentIndex = -1;
        
        // Find current station in the list
        if (this.currentStation) {
            if (this.currentStation.type === 'radio') {
                currentIndex = currentList.findIndex(item => 
                    (item.stationuuid && this.currentStation.stationuuid && 
                     item.stationuuid === this.currentStation.stationuuid) || 
                    (item.uuid && this.currentStation.uuid && 
                     item.uuid === this.currentStation.uuid)
                );
            }
        }
        
        // If current station wasn't found, don't preload
        if (currentIndex === -1) return;
        
        // Get next station index
        const nextIndex = (currentIndex + 1) % currentList.length;
        const nextStation = currentList[nextIndex];
        
        // Preload next station
        if (nextStation && nextStation.type !== 'local') {
            this.preloadStation(nextStation);
        }
    }

    async playLocalMusic(song) {
        try {
            // Make sure song ID is stored as a string for comparison
            const songId = String(song.id);
            
            // If the song was saved to the file system, try to access it
            if (song.savedToFileSystem && song.filePath && this.hasFileSystemAccess) {
                try {
                    const folderHandle = await this.getMusicFolder();
                    if (folderHandle) {
                        const fileName = song.filePath.split('/').pop();
                        try {
                            const fileHandle = await folderHandle.getFileHandle(fileName);
                            const file = await fileHandle.getFile();
                            
                            // Create a temporary URL for the file
                            const url = URL.createObjectURL(file);
                            
                            this.currentStation = { ...song, type: 'local', id: songId };
                            this.audioElement.src = url;
                            
                            // Store the URL to revoke it later
                            this.currentStation.tempUrl = url;
                            
                            await this.audioElement.play();
                            this.isPlaying = true;
                            this.updatePlayerUI();
                            this.updateMusicCards();
                            this.updateNowPlayingIndicator();
                            return;
                        } catch (err) {
                            console.warn('Could not access file from filesystem:', err);
                            // Fall back to data URL method
                        }
                    }
                } catch (err) {
                    console.warn('Error accessing music folder:', err);
                    // Fall back to data URL method
                }
            }
            
            // Fall back to the stored URL (data URL) method
            this.currentStation = { ...song, type: 'local', id: songId };
            this.audioElement.src = song.url;
            
            await this.audioElement.play();
            this.isPlaying = true;
            this.updatePlayerUI();
            this.updateMusicCards();
            this.updateNowPlayingIndicator();
        } catch (error) {
            console.error('Local playback failed:', error);
            this.showError('Failed to play local music file');
        }
    }

    togglePlayPause() {
        // Ensure AudioContext is activated (browsers require user gesture)
        this.activateAudioContext();
        
        if (this.isPlaying) {
            // Currently playing, so pause
            this.audioElement.pause();
            this.isPlaying = false;
        } else {
            // Currently paused, so play
            if (this.audioElement.src) {
                const playPromise = this.audioElement.play();
                
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        this.isPlaying = true;
                    }).catch(error => {
                        console.error('Error playing audio:', error);
                        this.handleAudioError();
                    });
                }
            } else if (this.currentStation) {
                // Try to reload the current station
                this.playStation(this.currentStation);
                return;
            } else {
                console.log('Nothing to play');
                return;
            }
        }
        
        // Update all UI components
        this.updatePlayerState();
        
        // Update media session state
        this.updateMediaSession();
    }

    activateAudioContext() {
        // Some browsers require user interaction to activate AudioContext
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log('AudioContext activated');
            }).catch(error => {
                console.warn('Failed to activate AudioContext:', error);
            });
        }
    }

    playNext() {
        const currentList = this.getCurrentPlaylist();
        if (currentList.length === 0) return;

        let currentIndex = -1;
        
        // Check if we have a local music file or radio station
        if (this.currentStation) {
            if (this.currentStation.type === 'local') {
                // For local music files
                currentIndex = currentList.findIndex(item => item.id === this.currentStation.id);
            } else {
                // For radio stations - check both stationuuid and uuid fields
                currentIndex = currentList.findIndex(item => 
                    (item.stationuuid && this.currentStation.stationuuid && 
                     item.stationuuid === this.currentStation.stationuuid) || 
                    (item.uuid && this.currentStation.uuid && 
                     item.uuid === this.currentStation.uuid)
                );
            }
        }
        
        // If current station wasn't found, start from beginning
        if (currentIndex === -1) {
            currentIndex = 0;
        } else {
            // Move to next item
            currentIndex = (currentIndex + 1) % currentList.length;
        }
        
        const nextItem = currentList[currentIndex];
        console.log('Playing next item:', nextItem);

        // Play the next item based on its type
        if (nextItem.type === 'local' || (this.currentStation && this.currentStation.type === 'local')) {
            this.playLocalMusic(nextItem);
        } else {
            this.playStation(nextItem);
        }
    }

    playPrevious() {
        const currentList = this.getCurrentPlaylist();
        if (currentList.length === 0) return;

        let currentIndex = -1;
        
        // Check if we have a local music file or radio station
        if (this.currentStation) {
            if (this.currentStation.type === 'local') {
                // For local music files
                currentIndex = currentList.findIndex(item => item.id === this.currentStation.id);
            } else {
                // For radio stations - check both stationuuid and uuid fields
                currentIndex = currentList.findIndex(item => 
                    (item.stationuuid && this.currentStation.stationuuid && 
                     item.stationuuid === this.currentStation.stationuuid) || 
                    (item.uuid && this.currentStation.uuid && 
                     item.uuid === this.currentStation.uuid)
                );
            }
        }
        
        // If current station wasn't found, start from end
        if (currentIndex === -1) {
            currentIndex = currentList.length - 1;
        } else {
            // Move to previous item
            currentIndex = currentIndex === 0 ? currentList.length - 1 : currentIndex - 1;
        }
        
        const prevItem = currentList[currentIndex];
        console.log('Playing previous item:', prevItem);

        // Play the previous item based on its type
        if (prevItem.type === 'local' || (this.currentStation && this.currentStation.type === 'local')) {
            this.playLocalMusic(prevItem);
        } else {
            this.playStation(prevItem);
        }
    }

    getCurrentPlaylist() {
        const activeSection = document.querySelector('.content-section.active').id;
        
        switch (activeSection) {
            case 'radio-section':
                return this.stations;
            case 'favorites-section':
                return this.favorites;
            case 'my-stations-section':
                return this.myMusic;
            default:
                return [];
        }
    }

    toggleFavorite() {
        if (!this.currentStation) return;
        
        // If the current station doesn't have a type, assume it's a radio station
        if (!this.currentStation.type) {
            this.currentStation.type = 'radio';
        }
        
        if (this.currentStation.type !== 'radio') return;
        
        // Toggle the favorite status
        this.toggleStationFavorite(this.currentStation);
        
        // Update the favorite button in the top player UI
        const favoriteBtn = document.getElementById('favoriteBtn');
        const isFavorite = this.favorites.some(fav => 
            (fav.stationuuid && this.currentStation.stationuuid && 
             fav.stationuuid === this.currentStation.stationuuid) || 
            (fav.uuid && this.currentStation.uuid && 
             fav.uuid === this.currentStation.uuid)
        );
        
        if (favoriteBtn) {
            favoriteBtn.innerHTML = isFavorite 
                ? '<i class="fas fa-heart"></i>' 
                : '<i class="far fa-heart"></i>';
        }
        
        // Update landscape favorite button if it exists
        const landscapeFavoriteBtn = document.getElementById('landscapeFavoriteBtn');
        if (landscapeFavoriteBtn) {
            const favoriteIcon = landscapeFavoriteBtn.querySelector('i');
            const favoriteText = landscapeFavoriteBtn.querySelector('span');
            
            if (favoriteIcon) {
                favoriteIcon.className = isFavorite 
                    ? 'fas fa-heart' 
                    : 'far fa-heart';
            }
            
            if (favoriteText) {
                favoriteText.textContent = isFavorite ? 'Favorited' : 'Favorite';
            }
        }
    }

    toggleStationFavorite(station) {
        // Determine station ID (use stationuuid or uuid)
        const stationId = station.stationuuid || station.uuid;
        
        if (!stationId) {
            console.error('No station ID found for favoriting');
            return;
        }
        
        // Ensure the station has both uuid and stationuuid set for consistency
        if (station.uuid && !station.stationuuid) {
            station.stationuuid = station.uuid;
        } else if (station.stationuuid && !station.uuid) {
            station.uuid = station.stationuuid;
        }
        
        // Find if station is already a favorite
        const index = this.favorites.findIndex(fav => 
            (fav.stationuuid && fav.stationuuid === stationId) || 
            (fav.uuid && fav.uuid === stationId)
        );
        
        // Find any related favorite buttons for this station
        const favoriteButtons = document.querySelectorAll(`.station-card[data-station-id="${stationId}"] .favorite-btn`);
        
        if (index === -1) {
            // Not a favorite yet, add it
            // Make sure station has type property set
            if (!station.type) {
                station.type = 'radio';
            }
            this.favorites.push(station);
            
            // Update button states
            favoriteButtons.forEach(btn => {
                btn.classList.add('active');
                btn.title = 'Remove from favorites';
            });
        } else {
            // Already a favorite, remove it
            this.favorites.splice(index, 1);
            
            // Update button states
            favoriteButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.title = 'Add to favorites';
            });
        }
        
        // Save to localStorage
        localStorage.setItem('radiowave_favorites', JSON.stringify(this.favorites));
        
        // Update UI
        this.updatePlayerUI();
        this.renderStations();
        this.renderFavorites();
    }

    async countStationClick(stationUuid) {
        // Don't block on this operation and make it fail silently
        if (!stationUuid) return;
        
        try {
            const response = await fetch(`${this.apiBase}/json/vote/${stationUuid}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'RadioWave/1.0' // Add user agent to reduce rejections
                }
            });
            
            if (!response.ok) {
                console.log(`Failed to count click: ${response.status}`);
                return; // Fail silently, this is non-critical
            }
            
            console.log('Station click counted successfully');
        } catch (error) {
            console.log('Failed to count click:', error);
            // Non-critical, continue without showing error to user
        }
    }

    async checkFileSystemAccess() {
        // Check if the File System Access API is supported
        if ('showDirectoryPicker' in window) {
            this.hasFileSystemAccess = true;
            
            try {
                // Try to get persisted permission from previous sessions
                const musicFolderKey = 'radiowave_music_folder';
                const storedPermission = await navigator.permissions?.query({
                    name: 'persistent-storage'
                });
                
                if (storedPermission?.state === 'granted' && localStorage.getItem(musicFolderKey)) {
                    try {
                        const fileHandleToken = localStorage.getItem(musicFolderKey);
                        if (fileHandleToken) {
                            // If we have a stored handle, try to use it
                            console.log('Attempting to use stored file handle');
                        }
                    } catch (err) {
                        console.log('Could not reuse file handle:', err);
                    }
                }
            } catch (err) {
                console.log('File System Permission check error:', err);
            }
            
            console.log('File System Access API is supported');
        } else {
            this.hasFileSystemAccess = false;
            console.log('File System Access API is not supported');
        }
    }

    async getMusicFolder() {
        if (!this.hasFileSystemAccess) {
            console.log('File System Access API not supported');
            return null;
        }
        
        try {
            if (!this.musicFolderHandle) {
                // Show directory picker to let user choose where to save music
                const dirHandle = await window.showDirectoryPicker({
                    id: 'radioWaveMusicDir',
                    mode: 'readwrite',
                    startIn: 'music'
                });
                
                // Create a RadioWave_Music subfolder
                try {
                    this.musicFolderHandle = await dirHandle.getDirectoryHandle(
                        this.musicFolderName, 
                        { create: true }
                    );
                    
                    console.log('Music folder created/accessed successfully');
                    
                    // Try to persist permission
                    if (navigator.storage && navigator.storage.persist) {
                        const isPersisted = await navigator.storage.persist();
                        console.log(`Persisted storage permission: ${isPersisted}`);
                    }
                } catch (err) {
                    console.error('Error creating music subfolder:', err);
                    // Fallback to use the main directory if subfolder can't be created
                    this.musicFolderHandle = dirHandle;
                }
            }
            
            return this.musicFolderHandle;
        } catch (err) {
            console.error('Error accessing music folder:', err);
            return null;
        }
    }

    handleFileUpload(event) {
        const files = event.dataTransfer ? event.dataTransfer.files : event.target.files;
        
        // Filter only MP3 files
        const mp3Files = Array.from(files).filter(file => 
            file.type === 'audio/mp3' || file.name.toLowerCase().endsWith('.mp3')
        );
        
        if (mp3Files.length === 0) {
            this.showError('Only MP3 files are supported');
            this.hideUploadModal();
            return;
        }
        
        // Process each MP3 file
        mp3Files.forEach(file => {
            this.addLocalMusic(file);
        });
        
        this.hideUploadModal();
    }

    async addLocalMusic(file) {
        try {
            // First try to save to file system if supported
            let fileUrl = '';
            let savedToFileSystem = false;
            
            if (this.hasFileSystemAccess) {
                savedToFileSystem = await this.saveFileToMusicFolder(file);
            }
            
            if (!savedToFileSystem) {
                // Fallback to DataURL method if file system access fails
                fileUrl = await this.readFileAsDataURL(file);
            } else {
                // Use the file reference for files saved to the file system
                fileUrl = `filesystem:${this.musicFolderName}/${file.name}`;
            }
            
            // Create song object with string ID
            const songId = String(Date.now() + Math.random());
            const song = {
                id: songId,
                name: file.name.replace(/\.[^/.]+$/, ""),
                url: fileUrl,
                filePath: savedToFileSystem ? `${this.musicFolderName}/${file.name}` : null,
                savedToFileSystem: savedToFileSystem,
                size: this.formatFileSize(file.size),
                type: 'local'
            };

            this.myMusic.push(song);
            localStorage.setItem('radiowave_music', JSON.stringify(this.myMusic));
            this.renderMyMusic();
            
            // Show success message
            this.showSuccessToast(`Added "${song.name}" to My Music`);
        } catch (error) {
            console.error('Error adding local music:', error);
            this.showError(`Failed to add "${file.name}": ${error.message}`);
        }
    }
    
    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }
    
    async saveFileToMusicFolder(file) {
        try {
            const folderHandle = await this.getMusicFolder();
            if (!folderHandle) return false;
            
            // Create a new file in the directory
            const fileHandle = await folderHandle.getFileHandle(file.name, { create: true });
            
            // Create a writable stream
            const writable = await fileHandle.createWritable();
            
            // Write the file content
            await writable.write(file);
            
            // Close the stream
            await writable.close();
            
            console.log(`File ${file.name} saved to ${this.musicFolderName} folder`);
            return true;
        } catch (error) {
            console.error('Error saving file to music folder:', error);
            return false;
        }
    }
    
    async deleteLocalMusic(songId) {
        if (confirm('Delete this song?')) {
            // Ensure songId is a string for comparison
            songId = String(songId);
            const songIndex = this.myMusic.findIndex(song => String(song.id) === songId);
            
            if (songIndex !== -1) {
                const song = this.myMusic[songIndex];
                
                // Try to delete the file from the file system if it was saved there
                if (song.savedToFileSystem && song.filePath && this.hasFileSystemAccess) {
                    try {
                        const folderHandle = await this.getMusicFolder();
                        if (folderHandle) {
                            const fileName = song.filePath.split('/').pop();
                            try {
                                await folderHandle.removeEntry(fileName);
                                console.log(`File ${fileName} deleted from file system`);
                            } catch (err) {
                                console.warn('Could not delete file from filesystem:', err);
                            }
                        }
                    } catch (err) {
                        console.warn('Error accessing music folder for deletion:', err);
                    }
                }
                
                // If this is the currently playing song, clean up
                if (this.currentStation && String(this.currentStation.id) === songId) {
                    // Revoke any temporary URL
                    if (this.currentStation.tempUrl) {
                        URL.revokeObjectURL(this.currentStation.tempUrl);
                    }
                    
                    this.audioElement.pause();
                    this.currentStation = null;
                    this.isPlaying = false;
                    this.updatePlayerUI();
                }
                
                // Remove from array and update storage
                this.myMusic.splice(songIndex, 1);
                localStorage.setItem('radiowave_music', JSON.stringify(this.myMusic));
                this.renderMyMusic();
                
                // Show confirmation
                this.showSuccessToast('Song deleted successfully');
            }
        }
    }
    
    showSuccessToast(message) {
        // Create a toast notification
        const toast = document.createElement('div');
        toast.className = 'success-toast';
        toast.innerHTML = `
            <div class="success-icon"><i class="fas fa-check-circle"></i></div>
            <div class="success-message">${message}</div>
            <button class="success-close">&times;</button>
        `;
        
        // Add to body
        document.body.appendChild(toast);
        
        // Show with animation
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300); // Wait for animation to complete
        }, 3000);
        
        // Close button
        toast.querySelector('.success-close').addEventListener('click', () => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        });
    }

    switchSection(sectionName) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Update navigation menu
        document.querySelector(`.bottom-nav [data-section="${sectionName}"]`)?.classList.add('active');

        // Update content sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${sectionName}-section`).classList.add('active');

        // Also update landscape navigation if in landscape mode
        if (this.isLandscape) {
            this.updateLandscapeNav();
        }
    }

    filterStations() {
        if (this.searchQuery) {
            this.searchStations(this.searchQuery);
        } else {
            this.loadStations();
        }
    }

    updatePlayerUI() {
        const topPlayPauseBtn = document.getElementById('topPlayPauseBtn');
        const favoriteBtn = document.getElementById('favoriteBtn');

        if (this.currentStation) {
            const stationName = document.querySelector('.station-name');
            const stationStatus = document.querySelector('.station-status');
            
            stationName.textContent = this.currentStation.name || 'Unknown';
            stationStatus.textContent = this.currentStation.type === 'radio' 
                ? (this.currentStation.tags || 'Radio').split(',')[0] 
                : 'Local Music';

            topPlayPauseBtn.innerHTML = this.isPlaying 
                ? '<i class="fas fa-pause"></i>' 
                : '<i class="fas fa-play"></i>';

            // Update favorite button
            if (this.currentStation.type === 'radio') {
                const isFavorite = this.favorites.some(fav => fav.stationuuid === this.currentStation.stationuuid);
                favoriteBtn.innerHTML = isFavorite 
                    ? '<i class="fas fa-heart"></i>' 
                    : '<i class="far fa-heart"></i>';
                favoriteBtn.style.display = 'block';
            } else {
                favoriteBtn.style.display = 'none';
            }
        } else {
            document.querySelector('.station-name').textContent = 'Select a station';
            document.querySelector('.station-status').textContent = 'Radio';
            topPlayPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            favoriteBtn.innerHTML = '<i class="far fa-heart"></i>';
        }

        // Also update landscape UI if in landscape mode
        if (this.isLandscape) {
            this.updateLandscapePlayerUI();
        }
    }

    updateStationCards() {
        document.querySelectorAll('.station-card').forEach(card => {
            const stationId = card.dataset.stationId;
            const playBtn = card.querySelector('.play-btn i');
            
            if (this.currentStation) {
                // Check if this card matches the current station using either uuid or stationuuid
                const isCurrentStation = (
                    (this.currentStation.stationuuid && 
                     this.currentStation.stationuuid === stationId) ||
                    (this.currentStation.uuid && 
                     this.currentStation.uuid === stationId)
                );
                
                if (isCurrentStation) {
                    card.classList.add('active');
                    playBtn.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
                } else {
                    card.classList.remove('active');
                    playBtn.className = 'fas fa-play';
                }
            } else {
                card.classList.remove('active');
                playBtn.className = 'fas fa-play';
            }
        });
    }

    updateMusicCards() {
        document.querySelectorAll('#my-music-grid .station-card').forEach(card => {
            const songId = card.dataset.songId;
            const playBtn = card.querySelector('.play-btn i');
            
            if (this.currentStation && String(this.currentStation.id) === String(songId)) {
                card.classList.add('active');
                playBtn.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
            } else {
                card.classList.remove('active');
                playBtn.className = 'fas fa-play';
            }
        });
    }

    updatePlayerState() {
        this.updatePlayerUI();
        this.updateStationCards();
        this.updateMusicCards();
    }

    showError(message) {
        console.error(message);
        
        // Create a toast notification instead of alert
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.innerHTML = `
            <div class="error-icon"><i class="fas fa-exclamation-circle"></i></div>
            <div class="error-message">${message}</div>
            <button class="error-close">&times;</button>
        `;
        
        // Add to body
        document.body.appendChild(toast);
        
        // Show with animation
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto hide after 5 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300); // Wait for animation to complete
        }, 5000);
        
        // Close button
        toast.querySelector('.error-close').addEventListener('click', () => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        });
    }
    
    handleAudioError() {
        this.isPlaying = false;
        this.hideLoading();
        
        // Check if we have a current station to provide more context
        let errorMessage = '';
        
        if (this.currentStation) {
            errorMessage += `"${this.currentStation.name}" might be offline or unavailable.`;
            
            // Check if the station URL might have been blocked by CORS
            if (this.currentStation.url && (
                this.currentStation.url.includes('http:') || 
                this.currentStation.url.includes('https://www.radio.net') ||
                this.currentStation.url.includes('https://www.franceinter.fr')
            )) {
            }
        } else {
            errorMessage += ' Please select a station to play.';
        }
        
        this.showError(errorMessage);
        this.updatePlayerState();
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    debounce(func, wait) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(func, wait);
    }
    
    setVolume(value) {
        // Ensure value is between 0 and 100
        const volumeValue = Math.max(0, Math.min(100, value));
        
        // For iOS devices, we'll show a hint to use physical buttons the first time
        if (this.isIOS && !this.hasShownVolumeHint) {
            this.showVolumeHint();
            this.hasShownVolumeHint = true;
        }
        
        // Set audio volume (0-1 range)
        this.audioElement.volume = volumeValue / 100;
        
        // Try to set system volume if supported and not iOS
        // (For iOS we'll handle this differently)
        if (this.systemVolumeSupported && !this.isIOS) {
            this.setSystemVolume(volumeValue);
        } else if (this.isIOS && this.volumeChangeCount === undefined) {
            // First time on iOS, initialize counter and show hint
            this.volumeChangeCount = 0;
            this.showVolumeHint();
        } else if (this.isIOS) {
            // Count volume changes on iOS to determine if we should show a hint
            this.volumeChangeCount++;
            
            // Every 3 volume changes, remind iOS users to use physical buttons
            if (this.volumeChangeCount % 3 === 0) {
                this.setSystemVolume(volumeValue);
            }
        }
        
        // Update UI elements
        document.getElementById('volumeValue').textContent = `${volumeValue}%`;
        document.getElementById('volumeSlider').value = volumeValue;
        
        // Update the background to show the filled portion for the modal slider
        const percentage = volumeValue + '%';
        document.getElementById('volumeSlider').style.background = `linear-gradient(to right, var(--primary-color) ${percentage}, var(--card-color) ${percentage})`;
        
        // Update landscape volume slider if it exists
        const landscapeVolumeSlider = document.getElementById('landscapeVolumeSlider');
        const landscapeVolumeValue = document.getElementById('landscapeVolumeValue');
        
        if (landscapeVolumeSlider) {
            landscapeVolumeSlider.value = volumeValue;
            // Update the background to show the filled portion
            landscapeVolumeSlider.style.background = `linear-gradient(to right, var(--primary-color) ${percentage}, var(--card-color) ${percentage})`;
        }
        
        if (landscapeVolumeValue) {
            landscapeVolumeValue.textContent = `${volumeValue}%`;
        }
        
        // Update volume icon
        this.updateVolumeIcon(volumeValue);
        
        // Save to localStorage
        localStorage.setItem('radiowave_volume', volumeValue);
    }
    
    setSystemVolume(volumeValue) {
        if (!this.systemVolumeSupported) return;
        
        try {
            // Use normalized value (0-1)
            const normalizedVolume = volumeValue / 100;
            
            // For iOS Safari, we need to try a different approach
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isIOS) {
                // On iOS, we need to trigger the native volume UI
                // This is a workaround as direct system volume control isn't allowed
                // First mute the audio briefly
                const originalVolume = this.audioElement.volume;
                this.audioElement.volume = 0;
                
                // Small timeout to let the UI update
                setTimeout(() => {
                    // Then restore volume - this often triggers the native volume UI
                    this.audioElement.volume = originalVolume;
                    
                    // Force a user interaction with audio to show volume controls
                    if (this.isPlaying) {
                        this.audioElement.pause();
                        this.audioElement.play().catch(err => console.warn('Auto-play after volume change failed:', err));
                    }
                }, 50);
                
                // Show a message to the user
                this.showVolumeHint();
                
                return true;
            }
            
            // Different approaches to control system volume
            if ('mediaSession' in navigator && navigator.mediaSession.setVolume) {
                navigator.mediaSession.setVolume(normalizedVolume);
                return true;
            } 
            
            // Try Volume Manager API if available (some mobile browsers)
            if (navigator.volumeManager && navigator.volumeManager.setVolume) {
                navigator.volumeManager.setVolume(normalizedVolume);
                return true;
            }
            
            // Last resort: AudioContext gain (works on some browsers but not for system volume)
            if (this.audioContext) {
                try {
                    // Create a gain node if we don't have one
                    if (!this.gainNode) {
                        this.gainNode = this.audioContext.createGain();
                        this.gainNode.connect(this.audioContext.destination);
                    }
                    
                    // Set the gain value
                    this.gainNode.gain.value = normalizedVolume;
                    return true;
                } catch (gainError) {
                    console.warn('Gain node error:', gainError);
                }
            }
            
            return false;
        } catch (error) {
            console.warn('System volume control error:', error);
            return false;
        }
    }
    
    showVolumeHint() {
        // Create volume hint message if it doesn't exist
        let hint = document.getElementById('volume-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'volume-hint';
            hint.style.position = 'fixed';
            hint.style.bottom = '70px';
            hint.style.left = '50%';
            hint.style.transform = 'translateX(-50%)';
            hint.style.backgroundColor = 'rgba(0,0,0,0.8)';
            hint.style.color = 'white';
            hint.style.padding = '10px 15px';
            hint.style.borderRadius = '20px';
            hint.style.fontSize = '14px';
            hint.style.zIndex = '9999';
            hint.style.textAlign = 'center';
            hint.style.transition = 'opacity 0.3s ease';
            hint.style.opacity = '0';
            document.body.appendChild(hint);
        }
        
        // Set appropriate message based on device
        let message = 'Use volume buttons to adjust system volume';
        if (this.isIOS) {
            message = 'Use iPhone volume buttons to change system volume';
            
            // If we've shown this hint many times, give more detailed instructions
            if (this.volumeChangeCount > 6) {
                message = 'iOS restricts apps from changing system volume. Please use your iPhone\'s physical volume buttons.';
            }
        }
        
        // Show the hint with the message
        hint.textContent = message;
        hint.style.opacity = '1';
        
        // Hide the hint after 4 seconds
        setTimeout(() => {
            hint.style.opacity = '0';
            // Remove the element after fade out
            setTimeout(() => {
                if (hint.parentNode) {
                    hint.parentNode.removeChild(hint);
                }
            }, 300);
        }, 4000);
    }
    
    updateVolumeIcon(value) {
        const iconClass = value === 0 ? 'fa-volume-mute' : 
                        value < 30 ? 'fa-volume-off' : 
                        value < 70 ? 'fa-volume-down' : 
                        'fa-volume-up';
        
        // Update top volume icon if exists
        const volumeIcon = document.getElementById('volumeIcon');
        if (volumeIcon) {
            volumeIcon.className = `fas ${iconClass}`;
        }
        
        // Update landscape volume icon
        const landscapeVolumeIcon = document.getElementById('landscapeVolumeIcon');
        if (landscapeVolumeIcon) {
            landscapeVolumeIcon.className = `fas ${iconClass}`;
        }
    }
    
    toggleVolumeModal() {
        const modal = document.getElementById('volumeModal');
        modal.classList.toggle('show');
        
        setTimeout(() => {
            if (modal.classList.contains('show')) {
                modal.classList.remove('show');
            }
        }, 3000);
    }
    
    showUploadModal() {
        document.getElementById('uploadModal').classList.add('show');
    }
    
    hideUploadModal() {
        document.getElementById('uploadModal').classList.remove('show');
    }
    
    showLoading() {
        // Loading indicator is handled by CSS
    }
    
    hideLoading() {
        // Loading indicator is handled by CSS
    }
    
    setupOrientationHandling() {
        // Listen for orientation changes
        window.addEventListener('orientationchange', () => {
            // Delay check to allow for transition
            setTimeout(() => this.checkOrientation(), 200);
        });
        
        // Listen for resize events (for desktop testing)
        window.addEventListener('resize', () => {
            this.debounce(() => this.checkOrientation(), 100);
        });
        
        // Listen for screen orientation API if available
        if (screen.orientation) {
            screen.orientation.addEventListener('change', () => {
                setTimeout(() => this.checkOrientation(), 200);
            });
        }
    }
    
    checkOrientation() {
        const isLandscapeNow = this.isLandscapeMode();
        
        if (isLandscapeNow !== this.isLandscape) {
            this.isLandscape = isLandscapeNow;
            this.handleOrientationChange();
        }
    }
    
    isLandscapeMode() {
        // Check multiple indicators for landscape mode
        const windowAspect = window.innerWidth / window.innerHeight;
        const orientationAngle = screen.orientation ? screen.orientation.angle : window.orientation;
        const isLandscapeBySize = windowAspect > 1.3 && window.innerHeight <= 600;
        const isLandscapeByOrientation = orientationAngle === 90 || orientationAngle === -90 || orientationAngle === 270;
        
        return isLandscapeBySize || isLandscapeByOrientation;
    }
    
    handleOrientationChange() {
        console.log('Orientation changed to:', this.isLandscape ? 'Landscape' : 'Portrait');
        
        if (this.isLandscape) {
            this.enterLandscapeMode();
        } else {
            this.exitLandscapeMode();
        }
        
        // Update player UI for new orientation
        setTimeout(() => {
            this.updatePlayerUI();
            this.updateNowPlayingIndicator();
            
            // Force station cards to recalculate their layout
            if (this.isLandscape) {
                const stationsGrid = document.querySelector('.stations-grid');
                if (stationsGrid) {
                    stationsGrid.style.display = 'none';
                    setTimeout(() => {
                        stationsGrid.style.display = 'grid';
                    }, 50);
                }
            }
        }, 300);
    }
    
    enterLandscapeMode() {
        console.log('Entering car mode (landscape)');
        
        // Show landscape controls panel
        const landscapeControlsPanel = document.getElementById('landscapeControlsPanel');
        if (landscapeControlsPanel) {
            landscapeControlsPanel.style.display = 'flex';
        }
        
        // Hide landscape extras
        const landscapeExtras = document.getElementById('landscapeExtras');
        if (landscapeExtras) {
            landscapeExtras.style.display = 'none';
        }
        
        // Hide now playing indicator
        const nowPlayingIndicator = document.getElementById('landscapeNowPlaying');
        if (nowPlayingIndicator) {
            nowPlayingIndicator.style.display = 'none';
        }
        
        // Add landscape class to body for additional styling if needed
        document.body.classList.add('landscape-mode');
        
        // Update landscape UI
        this.updateLandscapePlayerUI();
        this.updateLandscapeNav();
        
        // Ensure proper scroll position
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.scrollTop = 0;
        }
        
        // Set initial volume slider value
        const landscapeVolumeSlider = document.getElementById('landscapeVolumeSlider');
        if (landscapeVolumeSlider) {
            const currentVolume = Math.round(this.audioElement.volume * 100);
            landscapeVolumeSlider.value = currentVolume;
        }
    }
    
    exitLandscapeMode() {
        console.log('Exiting car mode (portrait)');
        
        // Hide landscape controls panel
        const landscapeControlsPanel = document.getElementById('landscapeControlsPanel');
        if (landscapeControlsPanel) {
            landscapeControlsPanel.style.display = 'none';
        }
        
        // Hide now playing indicator
        const nowPlayingIndicator = document.getElementById('landscapeNowPlaying');
        if (nowPlayingIndicator) {
            nowPlayingIndicator.classList.remove('show');
        }
        
        // Remove landscape class
        document.body.classList.remove('landscape-mode');
    }
    
    updateNowPlayingIndicator() {
        const nowPlayingIndicator = document.getElementById('landscapeNowPlaying');
        if (!nowPlayingIndicator) return;
        
        if (this.isLandscape && this.currentStation && this.isPlaying) {
            const icon = nowPlayingIndicator.querySelector('i');
            const text = nowPlayingIndicator.querySelector('span');
            
            if (icon && text) {
                icon.className = this.isPlaying ? 'fas fa-play' : 'fas fa-pause';
                text.textContent = this.currentStation.name || 'Now Playing';
            }
            
            nowPlayingIndicator.classList.add('show');
            
            // Auto-hide after 3 seconds
            clearTimeout(this.landscapeTimeout);
            this.landscapeTimeout = setTimeout(() => {
                nowPlayingIndicator.classList.remove('show');
            }, 3000);
        } else {
            nowPlayingIndicator.classList.remove('show');
        }
    }
    
    updateLandscapePlayerUI() {
        const landscapePlayPauseBtn = document.getElementById('landscapePlayPauseBtn');
        const landscapeFavoriteBtn = document.getElementById('landscapeFavoriteBtn');
        
        if (!landscapePlayPauseBtn || !landscapeFavoriteBtn) return;
        
        if (this.currentStation) {
            const stationName = document.querySelector('.landscape-station-name');
            const stationStatus = document.querySelector('.landscape-station-status');
            
            if (stationName && stationStatus) {
                stationName.textContent = this.currentStation.name || 'Unknown';
                stationStatus.textContent = this.currentStation.type === 'radio' 
                    ? (this.currentStation.tags || 'Radio').split(',')[0] 
                    : 'Local Music';
            }
            
            landscapePlayPauseBtn.innerHTML = this.isPlaying 
                ? '<i class="fas fa-pause"></i>' 
                : '<i class="fas fa-play"></i>';
            
            // Update favorite button
            const favoriteIcon = landscapeFavoriteBtn.querySelector('i');
            const favoriteText = landscapeFavoriteBtn.querySelector('span');
            
            if (this.currentStation.type === 'radio') {
                const isFavorite = this.favorites.some(fav => fav.stationuuid === this.currentStation.stationuuid);
                if (favoriteIcon) {
                    favoriteIcon.className = isFavorite 
                        ? 'fas fa-heart' 
                        : 'far fa-heart';
                }
                if (favoriteText) {
                    favoriteText.textContent = isFavorite ? 'Favorited' : 'Favorite';
                }
                landscapeFavoriteBtn.style.display = 'flex';
            } else {
                landscapeFavoriteBtn.style.display = 'none';
            }
        } else {
            const stationName = document.querySelector('.landscape-station-name');
            const stationStatus = document.querySelector('.landscape-station-status');
            
            if (stationName && stationStatus) {
                stationName.textContent = 'Select a station';
                stationStatus.textContent = 'Radio';
            }
            
            landscapePlayPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            
            const favoriteIcon = landscapeFavoriteBtn.querySelector('i');
            const favoriteText = landscapeFavoriteBtn.querySelector('span');
            
            if (favoriteIcon) favoriteIcon.className = 'far fa-heart';
            if (favoriteText) favoriteText.textContent = 'Favorite';
        }
    }
    
    updateLandscapeNav() {
        // Get active section
        const activeSection = document.querySelector('.content-section.active')?.id?.replace('-section', '') || 'radio';
        
        // Update landscape nav
        document.querySelectorAll('.landscape-nav-item').forEach(item => {
            if (item.dataset.section === activeSection) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }
    
    setupMediaSession() {
        try {
            // Detect iOS
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            this.isIOS = isIOS;
            
            // Initialize AudioContext for potential volume control
            if (!this.audioContext && (window.AudioContext || window.webkitAudioContext)) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Create a connection to the audio element through the AudioContext
                // Skip for iOS since it often causes issues
                if (this.audioElement && this.audioContext && !isIOS) {
                    try {
                        const source = this.audioContext.createMediaElementSource(this.audioElement);
                        source.connect(this.audioContext.destination);
                    } catch (error) {
                        console.warn('Could not connect audio element to context:', error);
                    }
                }
                
                // On iOS, we'll use a different approach for volume, but mark as supported
                if (isIOS) {
                    this.systemVolumeSupported = true;
                    console.log('Using iOS-specific volume control approach');
                }
                // Check if the browser supports system volume control via MediaSession
                else if ('mediaSession' in navigator) {
                    if (navigator.mediaSession.setVolume) {
                        this.systemVolumeSupported = true;
                        console.log('System volume control is supported via MediaSession API');
                    }
                }
                
                // Check for other volume control APIs
                if (navigator.volumeManager && navigator.volumeManager.setVolume) {
                    this.systemVolumeSupported = true;
                    console.log('System volume control is supported via Volume Manager API');
                }
                
                // Setup media session controls - these will work on iOS for playback controls
                // but not for volume control
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: 'RadioWave',
                        artist: 'Tuning...',
                        album: 'RadioWave App',
                        artwork: [
                            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }
                        ]
                    });
                    
                    // Set action handlers for media keys
                    navigator.mediaSession.setActionHandler('play', () => this.togglePlayPause());
                    navigator.mediaSession.setActionHandler('pause', () => this.togglePlayPause());
                    navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
                    navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrevious());
                }
            }
        } catch (error) {
            console.warn('Media session setup error:', error);
            this.systemVolumeSupported = false;
        }
    }
    
    updateMediaSession() {
        if (!('mediaSession' in navigator)) return;
        
        try {
            // Update media session metadata with current playing info
            const title = this.currentStation ? this.currentStation.name : 
                        this.currentMusic ? this.currentMusic.name : 'RadioWave';
            const artist = this.currentStation ? 'Radio Station' : 
                            this.currentMusic ? this.currentMusic.artist || 'Local Music' : 'Tuning...';
            
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: 'RadioWave App',
                artwork: [
                    { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }
                ]
            });
            
            // Update playback state
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        } catch (error) {
            console.warn('Media session update error:', error);
        }
    }

    setupNetworkDetection() {
        // Initial online status
        this.isOnline = navigator.onLine;
        console.log(`App starting ${this.isOnline ? 'online' : 'offline'}`);
        
        // Listen for online status changes
        window.addEventListener('online', () => {
            console.log('App is now online');
            this.isOnline = true;
            this.showSuccessToast('You are now online. Radio stations available.');
            
            // Reload stations if we're in the radio section
            if (document.getElementById('radio-section').classList.contains('active')) {
                this.loadStations();
            }
        });
        
        window.addEventListener('offline', () => {
            console.log('App is now offline');
            this.isOnline = false;
            this.showError('You are offline. Radio stations are not available.');
            
            // If in radio section, switch to My Music
            if (document.getElementById('radio-section').classList.contains('active')) {
                this.switchSection('my-music');
            }
        });
        
        // Add offline indicator to the UI
        const appContainer = document.querySelector('.app-container');
        const offlineIndicator = document.createElement('div');
        offlineIndicator.className = 'offline-indicator';
        offlineIndicator.innerHTML = '<i class="fas fa-wifi-slash"></i> Offline Mode';
        // Check if the icon exists in Font Awesome 6.4.0, if not use alternative
        setTimeout(() => {
            const icon = offlineIndicator.querySelector('i');
            const style = window.getComputedStyle(icon);
            const fontFamily = style.getPropertyValue('font-family');
            if (!fontFamily.includes('Font Awesome') || icon.clientWidth === 0) {
                // Fallback to a standard icon
                icon.className = 'fas fa-exclamation-triangle';
            }
        }, 500);
        
        offlineIndicator.style.display = this.isOnline ? 'none' : 'block';
        appContainer.appendChild(offlineIndicator);
        
        // Update indicator when online status changes
        window.addEventListener('online', () => {
            offlineIndicator.style.display = 'none';
        });
        
        window.addEventListener('offline', () => {
            offlineIndicator.style.display = 'block';
        });
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.radioWaveApp = new RadioWaveApp();
    
    // Add install button after app loads
    setTimeout(addInstallButton, 2000);
});

// Handle PWA install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Update UI to notify the user they can add to home screen
    showInstallPromotion();
});

// Show install promotion UI
function showInstallPromotion() {
    // Make sure the install button is visible
    const installButton = document.getElementById('pwa-install-button');
    if (installButton) {
        installButton.style.display = 'block';
    }
}

// Add install button to the UI
function addInstallButton() {
    // Only add if not already added
    if (document.getElementById('pwa-install-button')) return;
    
    // Create install button
    const installButton = document.createElement('button');
    installButton.id = 'pwa-install-button';
    installButton.className = 'pwa-install-button';
    installButton.innerHTML = '<i class="fas fa-download"></i> Install App';
    
    // Hide by default if no prompt available
    if (!deferredPrompt) {
        installButton.style.display = 'none';
    }
    
    // Add click handler
    installButton.addEventListener('click', installPWA);
    
    // Add to body
    document.body.appendChild(installButton);
    
    // Add CSS for the button
    const style = document.createElement('style');
    style.textContent = `
        .pwa-install-button {
            position: fixed;
            bottom: 80px;
            right: 20px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 24px;
            padding: 10px 16px;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            z-index: 100;
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        .pwa-install-button i {
            margin-right: 8px;
        }
        @media (max-width: 768px) {
            .pwa-install-button {
                bottom: 80px;
                right: 16px;
            }
        }
    `;
    document.head.appendChild(style);
}

// Install PWA function
function installPWA() {
    // Hide install promotion
    const installButton = document.getElementById('pwa-install-button');
    if (installButton) {
        installButton.style.display = 'none';
    }
    
    // Show the install prompt
    if (deferredPrompt) {
        deferredPrompt.prompt();
        
        // Wait for the user to respond to the prompt
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('User accepted the install prompt');
                // Show success message
                const toast = document.createElement('div');
                toast.className = 'success-toast';
                toast.innerHTML = `
                    <div class="success-icon"><i class="fas fa-check-circle"></i></div>
                    <div class="success-message">App installation started!</div>
                `;
                document.body.appendChild(toast);
                setTimeout(() => toast.classList.add('show'), 10);
                setTimeout(() => {
                    toast.classList.remove('show');
                    setTimeout(() => document.body.removeChild(toast), 300);
                }, 3000);
            } else {
                console.log('User dismissed the install prompt');
            }
            // Clear the saved prompt since it can't be used again
            deferredPrompt = null;
        });
    } else {
        // If no deferred prompt, show instructions
        window.radioWaveApp.showError('Please use your browser menu to install this app or add to home screen');
    }
}

// Handle app installation
window.addEventListener('appinstalled', () => {
    console.log('RadioWave PWA was installed');
    // Hide install button after successful installation
    const installButton = document.getElementById('pwa-install-button');
    if (installButton) {
        installButton.style.display = 'none';
    }
    
    // Show success message
    window.radioWaveApp.showSuccessToast('App installed successfully!');
});