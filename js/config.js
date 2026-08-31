/**
 * SUSKII Landing Page — Centralized Configuration
 * All marketing content, URLs, and feature flags in one place.
 * Update this file to change content without touching HTML/CSS.
 */

const SUSKII_CONFIG = {
  brand: {
    name: 'SUSKII',
    tagline: 'A market for anything salable',
    description: 'SUSKII is the marketplace where you discover, buy, and sell anything — from gadgets and fashion to property and vehicles. All in one app.',
    supportEmail: 'support@suskii.com',
    website: 'https://suskii.com',
    foundedYear: 2026,
  },

  storeLinks: {
    googlePlay: 'https://play.google.com/store/apps/details?id=com.suskii.app',
    appleStore: '', // Add when available
    appleStoreAvailable: false,
  },

  socialMedia: {
    facebook: 'https://www.facebook.com/profile.php?id=61592829380893',
    instagramPrimary: 'https://www.instagram.com/suskiiapp',
    instagramSecondary: 'https://www.instagram.com/suski.i2026',
    tiktok: 'https://www.tiktok.com/@suskii2026',
    linkedin: 'https://www.linkedin.com/in/suskii2026/',
  },

  legal: {
    privacyPolicyUrl: '#privacy',
    termsUrl: '#terms',
    communityGuidelinesUrl: '#community-guidelines',
  },

  // Feature flags — hide sections until real data is available
  features: {
    showSocialProof: false,       // Set true when real ratings/downloads available
    showTestimonials: false,      // Set true when real testimonials available
    showAsSeenIn: false,          // Set true when real press coverage exists
    showVideoSection: false,      // Set true when real video content available
    showReferralRewards: false,   // Set true when reward program launches
    appleStoreAvailable: false,   // Set true when iOS app launches
  },

  // Categories available on SUSKII
  categories: [
    { name: 'Properties', icon: 'home', description: 'Land, houses, shops & apartments' },
    { name: 'Gadgets', icon: 'smartphone', description: 'Phones, laptops & accessories' },
    { name: 'Vehicles', icon: 'car', description: 'Cars & transportation' },
    { name: 'Fashion', icon: 'shirt', description: 'Clothing, shoes & accessories' },
    { name: 'Electronics', icon: 'monitor', description: 'TVs, speakers & appliances' },
    { name: 'Hospitality', icon: 'hotel', description: 'Hotels & shortlet apartments' },
    { name: 'Furniture', icon: 'sofa', description: 'Home & office furniture' },
    { name: 'Services', icon: 'briefcase', description: 'Professional & local services' },
  ],

  // FAQ content
  faq: [
    {
      question: 'What is SUSKII?',
      answer: 'SUSKII is a peer-to-peer online marketplace where you can discover, buy, and sell legitimate products directly. From gadgets and fashion to property and vehicles — if it\'s salable, it\'s on SUSKII.'
    },
    {
      question: 'How do I buy on SUSKII?',
      answer: 'Download the SUSKII app, create your account, and start browsing. Use search or browse categories to find what you need. When you find something you like, contact the seller directly through the app to complete your purchase.'
    },
    {
      question: 'How do I sell on SUSKII?',
      answer: 'Selling is simple. Create your SUSKII account, tap the list button, add photos and details of your product, set your price, and publish. Your listing will be visible to buyers in your area and beyond.'
    },
    {
      question: 'Is SUSKII free to use?',
      answer: 'Creating an account and browsing products on SUSKII is completely free. Download the app and start exploring the marketplace at no cost.'
    },
    {
      question: 'How does payment work?',
      answer: 'SUSKII connects buyers and sellers directly. Payment arrangements are made between the buyer and seller. Always meet in safe, public locations for in-person transactions.'
    },
    {
      question: 'How is my data protected?',
      answer: 'Your privacy matters to us. SUSKII uses secure authentication to protect your account. We never share your personal information with other users without your consent. Read our Privacy Policy for full details.'
    },
    {
      question: 'Where is SUSKII available?',
      answer: 'SUSKII is currently available in Nigeria and Rwanda, with plans to expand to more countries. Download the app to see what\'s available in your area.'
    },
    {
      question: 'How do I download the SUSKII app?',
      answer: 'SUSKII is available on the Google Play Store for Android devices. Search for "SUSKII" or use the download links on this page. iOS version coming soon.'
    },
  ],

  // Chat assistant FAQ responses
  chatResponses: {
    greeting: "Hi! 👋 I'm here to help you learn about SUSKII. What would you like to know?",
    fallback: "I'm not sure about that. You can check our FAQ section or reach out to support@suskii.com for more help.",
    keywords: {
      'what is suskii': 'SUSKII is a peer-to-peer marketplace where you can buy and sell anything — gadgets, fashion, property, vehicles, and more. It\'s like having an entire market in your pocket! 🛒',
      'how to buy': 'Buying on SUSKII is easy! Download the app, create an account, browse or search for products, and contact the seller directly. You can filter by category, location, and price. 🛍️',
      'how to sell': 'To sell on SUSKII: 1) Create your account, 2) Tap the "+" button, 3) Add photos and details, 4) Set your price, 5) Publish! Your listing goes live instantly. 💰',
      'download': 'You can download SUSKII from the Google Play Store. Look for the download buttons at the top or bottom of this page! 📱',
      'free': 'Yes! SUSKII is free to download and use. Creating an account and browsing products costs nothing. 🎉',
      'safe': 'SUSKII uses secure authentication to protect your account. We recommend meeting in public places for in-person transactions and never sharing financial information in chat. 🔒',
      'available': 'SUSKII is currently available in Nigeria and Rwanda. We\'re expanding to more countries soon! 🌍',
      'contact': 'You can reach our support team at support@suskii.com. We\'re here to help! 📧',
    }
  },

  // i18n preparation
  locale: {
    defaultLanguage: 'en',
    defaultCurrency: 'NGN',
    defaultCountry: 'NG',
    supportedLanguages: ['en'],
  },
};

// Freeze config to prevent accidental mutations
Object.freeze(SUSKII_CONFIG);
