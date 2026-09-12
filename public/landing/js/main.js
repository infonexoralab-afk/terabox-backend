/**
 * TeraBox Cloud Storage - Main Interactive JavaScript
 * Modern, Lightweight & High Performance
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 1. Sticky Navigation Blur & Shadow on Scroll
  // ─────────────────────────────────────────────────────────────
  const header = document.querySelector('.site-header');
  const handleHeaderScroll = () => {
    if (window.scrollY > 20) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  };
  window.addEventListener('scroll', handleHeaderScroll, { passive: true });
  handleHeaderScroll();

  // ─────────────────────────────────────────────────────────────
  // 2. Mobile Drawer Navigation Toggle
  // ─────────────────────────────────────────────────────────────
  const mobileToggle = document.getElementById('mobileToggle');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const mobileLinks = document.querySelectorAll('.mobile-nav-link');

  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = mobileDrawer.classList.toggle('open');
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      
      // Animate hamburger lines
      const spans = mobileToggle.querySelectorAll('span');
      if (spans.length === 3) {
        if (isOpen) {
          spans[0].style.transform = 'translateY(7.5px) rotate(45deg)';
          spans[1].style.opacity = '0';
          spans[2].style.transform = 'translateY(-7.5px) rotate(-45deg)';
        } else {
          spans[0].style.transform = 'none';
          spans[1].style.opacity = '1';
          spans[2].style.transform = 'none';
        }
      }
    });

    // Close mobile drawer when clicking a link
    mobileLinks.forEach((link) => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
        const spans = mobileToggle.querySelectorAll('span');
        if (spans.length === 3) {
          spans[0].style.transform = 'none';
          spans[1].style.opacity = '1';
          spans[2].style.transform = 'none';
        }
      });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileDrawer.contains(e.target) && !mobileToggle.contains(e.target)) {
        mobileDrawer.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
        const spans = mobileToggle.querySelectorAll('span');
        if (spans.length === 3) {
          spans[0].style.transform = 'none';
          spans[1].style.opacity = '1';
          spans[2].style.transform = 'none';
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. ScrollSpy Active Link Navigation
  // ─────────────────────────────────────────────────────────────
  const sections = document.querySelectorAll('section[id]');
  const desktopNavLinks = document.querySelectorAll('.nav-links .nav-link');

  const highlightNavOnScroll = () => {
    const scrollY = window.pageYOffset + 120;
    sections.forEach((current) => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop;
      const sectionId = current.getAttribute('id');

      if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
        desktopNavLinks.forEach((link) => {
          if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  };
  window.addEventListener('scroll', highlightNavOnScroll, { passive: true });

  // ─────────────────────────────────────────────────────────────
  // 4. Live Referral & Webmaster CPM Income Calculator
  // ─────────────────────────────────────────────────────────────
  const viewsSlider = document.getElementById('viewsSlider');
  const viewsCountDisplay = document.getElementById('viewsCountDisplay');
  const earningsDisplay = document.getElementById('earningsDisplay');
  const refUsersSlider = document.getElementById('refUsersSlider');
  const refUsersCountDisplay = document.getElementById('refUsersCountDisplay');

  const calculateEarnings = () => {
    if (!viewsSlider || !earningsDisplay) return;

    const dailyViews = parseInt(viewsSlider.value, 10) || 5000;
    const newUsers = refUsersSlider ? parseInt(refUsersSlider.value, 10) || 50 : 50;

    // Display counts formatted
    if (viewsCountDisplay) {
      viewsCountDisplay.textContent = dailyViews.toLocaleString() + ' plays/day';
    }
    if (refUsersCountDisplay) {
      refUsersCountDisplay.textContent = newUsers.toLocaleString() + ' users/day';
    }

    // Calculation:
    // Video CPM = $4.00 per 1,000 plays -> (dailyViews / 1000) * 4 * 30 days
    // Referral CPA = $0.05 per user -> (newUsers * 0.05 * 30 days)
    const monthlyVideoIncome = (dailyViews / 1000) * 4.0 * 30;
    const monthlyRefIncome = newUsers * 0.05 * 30;
    const totalMonthly = monthlyVideoIncome + monthlyRefIncome;

    earningsDisplay.textContent = `$${Math.round(totalMonthly).toLocaleString()}/mo`;
  };

  if (viewsSlider) {
    viewsSlider.addEventListener('input', calculateEarnings);
  }
  if (refUsersSlider) {
    refUsersSlider.addEventListener('input', calculateEarnings);
  }
  calculateEarnings();

  // ─────────────────────────────────────────────────────────────
  // 5. Stat Counter Animation with IntersectionObserver
  // ─────────────────────────────────────────────────────────────
  const statNumbers = document.querySelectorAll('.stat-number');
  let statsAnimated = false;

  const animateCounters = () => {
    statNumbers.forEach((stat) => {
      const target = parseInt(stat.getAttribute('data-target'), 10);
      const suffix = stat.getAttribute('data-suffix') || '';
      const prefix = stat.getAttribute('data-prefix') || '';
      const duration = 2000;
      const startTime = performance.now();

      const updateCounter = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out quadratic
        const easeProgress = 1 - (1 - progress) * (1 - progress);
        const currentVal = Math.floor(easeProgress * target);

        stat.textContent = `${prefix}${currentVal.toLocaleString()}${suffix}`;

        if (progress < 1) {
          requestAnimationFrame(updateCounter);
        } else {
          stat.textContent = `${prefix}${target.toLocaleString()}${suffix}`;
        }
      };

      requestAnimationFrame(updateCounter);
    });
  };

  const statsSection = document.querySelector('.stats-card-container');
  if (statsSection && 'IntersectionObserver' in window) {
    const statsObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !statsAnimated) {
          statsAnimated = true;
          animateCounters();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.25 });
    statsObserver.observe(statsSection);
  } else {
    // Fallback
    animateCounters();
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Download Modal Popup Logic
  // ─────────────────────────────────────────────────────────────
  const modalOverlay = document.getElementById('downloadModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const triggerModalBtns = document.querySelectorAll('.trigger-download-modal');

  const openModal = (e) => {
    if (e) e.preventDefault();
    if (modalOverlay) {
      modalOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  };

  const closeModal = () => {
    if (modalOverlay) {
      modalOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  triggerModalBtns.forEach((btn) => {
    btn.addEventListener('click', openModal);
  });

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay?.classList.contains('active')) {
      closeModal();
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 7. Smooth Scroll for Internal Anchors
  // ─────────────────────────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = targetElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Copy Link / Share Toast feedback (helper)
  // ─────────────────────────────────────────────────────────────
  window.showToast = (message) => {
    let toast = document.getElementById('siteToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'siteToast';
      toast.style.position = 'fixed';
      toast.style.bottom = '24px';
      toast.style.right = '24px';
      toast.style.background = '#0F172A';
      toast.style.color = '#FFFFFF';
      toast.style.padding = '12px 24px';
      toast.style.borderRadius = '9999px';
      toast.style.border = '1px solid #334155';
      toast.style.fontSize = '14px';
      toast.style.fontWeight = '600';
      toast.style.boxShadow = 'none';
      toast.style.zIndex = '9999';
      toast.style.transition = 'all 0.2s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 3000);
  };
});
