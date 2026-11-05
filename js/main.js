/**
 * SUSKII — site interactions
 * Progressive enhancement only: every link and section works without JS.
 */
(() => {
    'use strict';

    const header = document.getElementById('site-header');
    const desktopQuery = window.matchMedia('(min-width: 1081px)');

    const storage = {
        get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ } },
    };

    // ─── Header: solid background once the page scrolls ───
    function initHeaderState() {
        if (!header || header.classList.contains('site-header--solid')) return;
        const update = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
        update();
        window.addEventListener('scroll', update, { passive: true });
    }

    // ─── Desktop "Our Platforms" menu ───
    function initPlatformsMenu() {
        const item = document.querySelector('.has-menu');
        if (!item) return;
        const trigger = item.querySelector('.primary-nav__trigger');
        const menu = item.querySelector('.mega-menu');
        let closeTimer;
        let openedByHover = false;

        const setOpen = (open) => {
            item.classList.toggle('is-open', open);
            trigger.setAttribute('aria-expanded', String(open));
            if (!open) openedByHover = false;
        };

        // A click right after hover-open should keep the menu open, not toggle it shut.
        trigger.addEventListener('click', () => {
            if (openedByHover) {
                openedByHover = false;
                return;
            }
            setOpen(trigger.getAttribute('aria-expanded') !== 'true');
        });

        item.addEventListener('mouseenter', () => {
            if (!desktopQuery.matches) return;
            clearTimeout(closeTimer);
            if (!item.classList.contains('is-open')) openedByHover = true;
            setOpen(true);
        });
        item.addEventListener('mouseleave', () => {
            closeTimer = setTimeout(() => setOpen(false), 160);
        });
        item.addEventListener('focusout', (e) => {
            if (!item.contains(e.relatedTarget)) setOpen(false);
        });
        menu.addEventListener('click', (e) => {
            if (e.target.closest('a')) setOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && item.classList.contains('is-open')) {
                setOpen(false);
                trigger.focus();
            }
        });
        document.addEventListener('click', (e) => {
            if (!item.contains(e.target)) setOpen(false);
        });
    }

    // ─── Mobile navigation drawer ───
    function initMobileNav() {
        const toggle = document.querySelector('.menu-toggle');
        const panel = document.getElementById('mobile-nav');
        if (!toggle || !panel) return;

        const setOpen = (open) => {
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            panel.hidden = !open;
            header.classList.toggle('is-open', open);
            document.documentElement.style.overflow = open ? 'hidden' : '';
            if (open) panel.querySelector('a')?.focus({ preventScroll: true });
        };

        toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
        panel.addEventListener('click', (e) => {
            if (e.target.closest('a')) setOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.hidden) {
                setOpen(false);
                toggle.focus();
            }
        });
        desktopQuery.addEventListener('change', (e) => {
            if (e.matches) setOpen(false);
        });
    }

    // ─── Scroll reveal ───
    function initReveal() {
        const items = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) {
            items.forEach((el) => el.classList.add('is-visible'));
            return;
        }

        // Stagger siblings that enter together
        document.querySelectorAll('.hero__copy, .app-grid, .bento, .about__pillars, .contact__grid').forEach((group) => {
            group.querySelectorAll(':scope > .reveal').forEach((el, i) => el.style.setProperty('--d', `${i * 0.08}s`));
        });

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

        items.forEach((el) => observer.observe(el));
    }

    // ─── Highlight the nav link for the section in view ───
    function initActiveSection() {
        const links = [...document.querySelectorAll('.primary-nav__link[href^="#"]')];
        if (!links.length || !('IntersectionObserver' in window)) return;
        const byId = new Map(links.map((link) => [link.getAttribute('href').slice(1), link]));
        const trigger = document.querySelector('.primary-nav__trigger');
        const platformIds = new Set(['platforms', 'marketplace', 'errands', 'travel']);

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const id = entry.target.id;
                links.forEach((link) => link.classList.remove('is-active'));
                trigger?.classList.toggle('is-active', platformIds.has(id));
                byId.get(id)?.classList.add('is-active');
            });
        }, { rootMargin: '-45% 0px -50% 0px' });

        ['ecosystem', 'platforms', 'about', 'contact'].forEach((id) => {
            const section = document.getElementById(id);
            if (section) observer.observe(section);
        });
    }

    // ─── Mobile "Install" bar for the live Marketplace app ───
    function initAppBar() {
        const bar = document.getElementById('app-bar');
        if (!bar || storage.get('suskii_app_bar_dismissed')) return;
        const isAndroidOrDesktop = !/iPad|iPhone|iPod/.test(navigator.userAgent);
        if (!isAndroidOrDesktop) return; // Marketplace is not on the App Store yet

        bar.hidden = false;
        const update = () => {
            const footer = document.querySelector('.site-footer');
            const nearEnd = footer && footer.getBoundingClientRect().top < window.innerHeight;
            bar.classList.toggle('is-visible', window.scrollY > 700 && !nearEnd);
        };
        window.addEventListener('scroll', update, { passive: true });
        update();

        bar.querySelector('.app-bar__close').addEventListener('click', () => {
            bar.classList.remove('is-visible');
            storage.set('suskii_app_bar_dismissed', '1');
            setTimeout(() => { bar.hidden = true; }, 450);
        });
    }

    function setYear() {
        document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    }

    [initHeaderState, initPlatformsMenu, initMobileNav, initReveal, initActiveSection, initAppBar, setYear].forEach((fn) => {
        try { fn(); } catch (err) { console.warn(`[SUSKII] ${fn.name} failed:`, err); }
    });
})();
