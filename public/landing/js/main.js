/**
 * AirBox Cloud Storage — Official Website Interactive Engine
 * Lightweight, 100% Responsive & High Performance
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // 1. Sticky Header Shadow on Scroll
  const header = document.querySelector('.site-header');
  const handleScroll = () => {
    if (window.scrollY > 15) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // 2. Mobile Drawer Navigation Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const mobileLinks = document.querySelectorAll('.mobile-link');

  const toggleDrawer = (force) => {
    const isOpen = typeof force === 'boolean' ? force : !mobileDrawer?.classList.contains('open');
    if (isOpen) {
      mobileDrawer?.classList.add('open');
      mobileMenuBtn?.classList.add('open');
      mobileMenuBtn?.setAttribute('aria-expanded', 'true');
    } else {
      mobileDrawer?.classList.remove('open');
      mobileMenuBtn?.classList.remove('open');
      mobileMenuBtn?.setAttribute('aria-expanded', 'false');
    }
  };

  mobileMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDrawer();
  });

  mobileLinks.forEach(link => {
    link.addEventListener('click', () => toggleDrawer(false));
  });

  document.addEventListener('click', (e) => {
    if (mobileDrawer?.classList.contains('open') && !mobileDrawer.contains(e.target) && !mobileMenuBtn?.contains(e.target)) {
      toggleDrawer(false);
    }
  });

  // 3. Download & Action Popup Modal
  const modal = document.getElementById('appModal');
  const closeBtn = document.getElementById('modalCloseBtn');
  const textCloseBtn = document.getElementById('modalTextCloseBtn');
  const triggerBtns = document.querySelectorAll('.trigger-modal');

  const openModal = (e) => {
    if (e) e.preventDefault();
    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  };

  const closeModal = () => {
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  };

  triggerBtns.forEach(btn => btn.addEventListener('click', openModal));
  closeBtn?.addEventListener('click', closeModal);
  textCloseBtn?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal?.classList.contains('active')) closeModal();
      if (mobileDrawer?.classList.contains('open')) toggleDrawer(false);
    }
  });

  // 4. Interactive FAQ Accordion
  const faqCards = document.querySelectorAll('.faq-card');
  faqCards.forEach(card => {
    const btn = card.querySelector('.faq-question-btn');
    btn?.addEventListener('click', () => {
      const isActive = card.classList.contains('active');
      // Optional: close other cards if accordion single mode is preferred, or allow multi-expand
      // Let's toggle current card
      if (isActive) {
        card.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
      } else {
        card.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // 5. Smooth Anchor Scroll with Header Offset
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 76;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
});

