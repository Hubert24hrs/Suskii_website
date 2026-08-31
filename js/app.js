/**
 * SUSKII Landing Page — Main Application Orchestrator
 * This file handles initialization, DOM injection based on config,
 * and ties together all interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // =========================================================================
    // 1. CONTENT INJECTION (Hydrating DOM from config.js)
    // =========================================================================

    function injectFeatures() {
        const container = document.querySelector('.features__grid');
        if (!container || !SUSKII_CONFIG.categories) return;

        let html = '';
        SUSKII_CONFIG.categories.forEach((cat, index) => {
            // Using placeholder emojis for icons. In production, use SVGs.
            const iconMap = {
                'Properties': '🏠', 'Gadgets': '📱', 'Vehicles': '🚗', 
                'Fashion': '👕', 'Electronics': '💻', 'Hospitality': '🏨', 
                'Furniture': '🛋️', 'Services': '💼'
            };
            
            const isOrange = index % 2 === 0;
            const iconClass = isOrange ? 'card__icon--orange' : 'card__icon--blue';

            html += `
                <div class="card hover-lift reveal-stagger">
                    <div class="card__icon ${iconClass}">${iconMap[cat.name] || '✨'}</div>
                    <h3 class="card__title">${cat.name}</h3>
                    <p class="card__description">${cat.description}</p>
                </div>
            `;
        });
        
        // Add a generic feature card
        html += `
            <div class="card hover-lift reveal-stagger">
                <div class="card__icon card__icon--orange">⚡</div>
                <h3 class="card__title">And Much More</h3>
                <p class="card__description">Discover thousands of unique items listed by users around you.</p>
            </div>
        `;

        container.innerHTML = html;
    }

    function injectFAQ() {
        const container = document.getElementById('faq-container');
        if (!container || !SUSKII_CONFIG.faq) return;

        let html = '';
        SUSKII_CONFIG.faq.forEach((item, index) => {
            html += `
                <div class="faq__item">
                    <button class="faq__question" aria-expanded="false" aria-controls="faq-answer-${index}">
                        ${item.question}
                        <svg class="faq__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <div class="faq__answer" id="faq-answer-${index}">
                        <div class="faq__answer-inner">
                            ${item.answer}
                        </div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    function injectSocialLinks() {
        const container = document.getElementById('footer-social');
        if (!container || !SUSKII_CONFIG.socialMedia) return;

        const { facebook, instagramPrimary, tiktok, linkedin } = SUSKII_CONFIG.socialMedia;
        
        // Simple SVG paths for social icons
        const icons = {
            fb: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>',
            ig: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>',
            tt: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5v3a3 3 0 0 1-3-3v10a4 4 0 1 1-4-4v3a1 1 0 0 0 1 1 1 1 0 0 0 1-1V12z"></path>',
            in: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle>'
        };

        let html = '';
        if (facebook) html += `<a href="${facebook}" target="_blank" rel="noopener" class="social-icon" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons.fb}</svg></a>`;
        if (instagramPrimary) html += `<a href="${instagramPrimary}" target="_blank" rel="noopener" class="social-icon" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons.ig}</svg></a>`;
        if (tiktok) html += `<a href="${tiktok}" target="_blank" rel="noopener" class="social-icon" aria-label="TikTok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons.tt}</svg></a>`;
        if (linkedin) html += `<a href="${linkedin}" target="_blank" rel="noopener" class="social-icon" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons.in}</svg></a>`;
        
        container.innerHTML = html;
    }

    function detectOSAndInjectBadges() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        const isIOS = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
        const isAndroid = /android/i.test(userAgent);
        
        const googlePlayBtn = `
            <a href="${SUSKII_CONFIG.storeLinks.googlePlay}" class="store-badge" target="_blank" rel="noopener">
                <svg class="store-badge__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span class="store-badge__text">
                    <span class="store-badge__label">Get it on</span>
                    <span class="store-badge__store">Google Play</span>
                </span>
            </a>
        `;
        
        let appleStoreBtn = '';
        if (SUSKII_CONFIG.storeLinks.appleStoreAvailable) {
            appleStoreBtn = `
                <a href="${SUSKII_CONFIG.storeLinks.appleStore}" class="store-badge" target="_blank" rel="noopener">
                    <svg class="store-badge__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"></path><path d="M10 2c1 .5 2 2 2 5h-2c0-3-1-4-2-5Z"></path></svg>
                    <span class="store-badge__text">
                        <span class="store-badge__label">Download on the</span>
                        <span class="store-badge__store">App Store</span>
                    </span>
                </a>
            `;
        } else {
            appleStoreBtn = `
                <div class="store-badge store-badge--disabled" title="Coming soon to iOS">
                    <svg class="store-badge__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"></path><path d="M10 2c1 .5 2 2 2 5h-2c0-3-1-4-2-5Z"></path></svg>
                    <span class="store-badge__text">
                        <span class="store-badge__label">Coming soon</span>
                        <span class="store-badge__store">App Store</span>
                    </span>
                </div>
            `;
        }

        // Logic: Show primary OS first, or both if desktop
        let badgesHtml = '';
        if (isIOS) {
            badgesHtml = appleStoreBtn + googlePlayBtn;
        } else if (isAndroid) {
            badgesHtml = googlePlayBtn + appleStoreBtn;
        } else {
            badgesHtml = googlePlayBtn + appleStoreBtn; // Desktop
        }

        // Always show QR codes across all platforms
        document.querySelectorAll('.qr-container').forEach(el => el.style.display = 'flex');

        // Inject into containers
        const containers = ['hero-store-badges', 'final-store-badges', 'footer-store-badges'];
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = badgesHtml;
        });
    }

    // =========================================================================
    // 2. INTERACTIVE BEHAVIORS
    // =========================================================================

    function initNavigation() {
        const nav = document.getElementById('main-nav');
        const menuToggle = document.getElementById('menu-toggle');
        const mobileMenu = document.getElementById('mobile-menu');
        const mobileLinks = document.querySelectorAll('.nav__mobile-link');
        
        // Sticky Nav
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                nav.classList.add('nav--scrolled');
            } else {
                nav.classList.remove('nav--scrolled');
            }
        });

        // Mobile Menu Toggle
        if (menuToggle && mobileMenu) {
            menuToggle.addEventListener('click', () => {
                const isOpen = mobileMenu.classList.contains('nav__mobile-menu--open');
                
                if (isOpen) {
                    mobileMenu.classList.remove('nav__mobile-menu--open');
                    menuToggle.classList.remove('nav__hamburger--active');
                    document.body.style.overflow = '';
                    menuToggle.setAttribute('aria-expanded', 'false');
                } else {
                    mobileMenu.classList.add('nav__mobile-menu--open');
                    menuToggle.classList.add('nav__hamburger--active');
                    document.body.style.overflow = 'hidden'; // Prevent scrolling
                    menuToggle.setAttribute('aria-expanded', 'true');
                }
            });
        }

        // Close mobile menu on link click
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileMenu.classList.remove('nav__mobile-menu--open');
                menuToggle.classList.remove('nav__hamburger--active');
                document.body.style.overflow = '';
                menuToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    function initFAQ() {
        const faqQuestions = document.querySelectorAll('.faq__question');
        
        faqQuestions.forEach(question => {
            question.addEventListener('click', () => {
                const item = question.parentElement;
                const answer = item.querySelector('.faq__answer');
                const isOpen = item.classList.contains('faq__item--open');
                
                // Close all other open FAQs
                document.querySelectorAll('.faq__item--open').forEach(openItem => {
                    if (openItem !== item) {
                        openItem.classList.remove('faq__item--open');
                        const openAnswer = openItem.querySelector('.faq__answer');
                        openAnswer.style.maxHeight = null;
                        openItem.querySelector('.faq__question').setAttribute('aria-expanded', 'false');
                    }
                });
                
                // Toggle current FAQ
                if (isOpen) {
                    item.classList.remove('faq__item--open');
                    answer.style.maxHeight = null;
                    question.setAttribute('aria-expanded', 'false');
                } else {
                    item.classList.add('faq__item--open');
                    answer.style.maxHeight = answer.scrollHeight + "px";
                    question.setAttribute('aria-expanded', 'true');
                }
            });
        });
    }

    function initScrollAnimations() {
        const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-stagger');
        
        const makeVisible = (el) => {
            if (el.classList.contains('reveal')) el.classList.add('reveal--visible');
            if (el.classList.contains('reveal-left')) el.classList.add('reveal-left--visible');
            if (el.classList.contains('reveal-right')) el.classList.add('reveal-right--visible');
            if (el.classList.contains('reveal-stagger')) el.classList.add('reveal-stagger--visible');
        };

        if (!('IntersectionObserver' in window)) {
            revealElements.forEach(makeVisible);
            return;
        }
        
        const revealOptions = {
            threshold: 0.05,
            rootMargin: "50px 0px 0px 0px"
        };
        
        const revealObserver = new IntersectionObserver(function(entries, observer) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    makeVisible(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, revealOptions);
        
        revealElements.forEach(el => {
            revealObserver.observe(el);
        });

        // Trigger visible immediately for elements already in viewport on load
        revealElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight + 100) {
                makeVisible(el);
            }
        });
    }

    function initMobileStickyCTA() {
        const cta = document.getElementById('mobile-cta');
        const closeBtn = document.getElementById('mobile-cta-close');
        
        if (!cta || !closeBtn) return;
        
        // Don't show if user dismissed it previously in this session
        if (sessionStorage.getItem('suskii_cta_dismissed')) return;
        
        // Show after scrolling past hero section
        window.addEventListener('scroll', () => {
            if (window.innerWidth > 768) return;
            
            if (window.scrollY > 600) {
                cta.classList.add('mobile-cta--visible');
                document.body.classList.add('has-mobile-cta');
            } else {
                cta.classList.remove('mobile-cta--visible');
                document.body.classList.remove('has-mobile-cta');
            }
        });
        
        closeBtn.addEventListener('click', () => {
            cta.classList.remove('mobile-cta--visible');
            document.body.classList.remove('has-mobile-cta');
            sessionStorage.setItem('suskii_cta_dismissed', 'true');
        });
    }

    function initChatBubble() {
        const trigger = document.getElementById('chat-trigger');
        const panel = document.getElementById('chat-panel');
        const close = document.getElementById('chat-close');
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        const messagesArea = document.getElementById('chat-messages');
        const suggestions = document.querySelectorAll('.chat-bubble__suggestion');
        
        if (!trigger || !panel) return;
        
        trigger.addEventListener('click', () => {
            panel.classList.toggle('chat-bubble__panel--open');
            if (panel.classList.contains('chat-bubble__panel--open')) {
                input.focus();
            }
        });
        
        close.addEventListener('click', () => {
            panel.classList.remove('chat-bubble__panel--open');
        });
        
        const appendMessage = (text, isUser = false) => {
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-bubble__message chat-bubble__message--${isUser ? 'user' : 'bot'}`;
            msgDiv.textContent = text;
            messagesArea.appendChild(msgDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        };
        
        const getBotResponse = (userInput) => {
            const inputLower = userInput.toLowerCase();
            const { keywords, fallback } = (SUSKII_CONFIG && SUSKII_CONFIG.chatResponses) ? SUSKII_CONFIG.chatResponses : { keywords: {}, fallback: "How can I help you with SUSKII today?" };
            
            for (const [key, response] of Object.entries(keywords)) {
                if (inputLower.includes(key)) {
                    return response;
                }
            }
            
            if (inputLower.includes('buy') || inputLower.includes('purchase')) return keywords['how to buy'] || fallback;
            if (inputLower.includes('sell') || inputLower.includes('list')) return keywords['how to sell'] || fallback;
            if (inputLower.includes('cost') || inputLower.includes('free') || inputLower.includes('price')) return keywords['free'] || fallback;
            if (inputLower.includes('app') || inputLower.includes('download') || inputLower.includes('install')) return keywords['download'] || fallback;
            
            return fallback;
        };
        
        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSend();
        });
        
        function handleSend() {
            const text = input.value.trim();
            if (!text) return;
            
            appendMessage(text, true);
            input.value = '';
            
            setTimeout(() => {
                const response = getBotResponse(text);
                appendMessage(response, false);
            }, 600);
        }
        
        suggestions.forEach(btn => {
            btn.addEventListener('click', () => {
                input.value = btn.textContent;
                handleSend();
            });
        });
    }

    // Modal Logic
    function initModal() {
        const triggers = document.querySelectorAll('.terms-trigger');
        const modal = document.getElementById('terms-modal');
        if (!modal) return;
        
        const closeBtn = modal.querySelector('[data-close-modal]');
        
        function openModal(e) {
            if (e) e.preventDefault();
            modal.classList.add('modal-overlay--open');
            document.body.style.overflow = 'hidden';
        }
        
        function closeModal() {
            modal.classList.remove('modal-overlay--open');
            document.body.style.overflow = '';
        }
        
        triggers.forEach(trigger => {
            trigger.addEventListener('click', openModal);
        });
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('modal-overlay--open')) {
                closeModal();
            }
        });
    }

    // Floating Section Navigation Logic
    function initFloatingNav() {
        const toggle = document.getElementById('floating-nav-toggle');
        const menu = document.getElementById('floating-nav-menu');
        
        if (!toggle || !menu) return;
        
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('floating-nav__menu--open');
        });
        
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && e.target !== toggle) {
                menu.classList.remove('floating-nav__menu--open');
            }
        });
        
        const links = menu.querySelectorAll('.floating-nav__link');
        links.forEach(link => {
            link.addEventListener('click', () => {
                menu.classList.remove('floating-nav__menu--open');
            });
        });
    }

    // =========================================================================
    // 3. SAFE EXECUTION
    // =========================================================================
    
    const safeExec = (fn, name) => {
        try {
            if (typeof fn === 'function') fn();
        } catch (err) {
            console.warn(`[SUSKII] Error executing ${name}:`, err);
        }
    };

    // Inject Content
    safeExec(injectFeatures, 'injectFeatures');
    safeExec(injectFAQ, 'injectFAQ');
    safeExec(injectSocialLinks, 'injectSocialLinks');
    safeExec(detectOSAndInjectBadges, 'detectOSAndInjectBadges');
    
    // Initialize Interactivity
    safeExec(initNavigation, 'initNavigation');
    safeExec(initScrollAnimations, 'initScrollAnimations');
    safeExec(initModal, 'initModal');
    safeExec(initFloatingNav, 'initFloatingNav');
    safeExec(initFAQ, 'initFAQ');
    safeExec(initMobileStickyCTA, 'initMobileStickyCTA');
    safeExec(initChatBubble, 'initChatBubble');
    
    // Set dynamic year in footer
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
});
