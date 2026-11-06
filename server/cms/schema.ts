/**
 * Content model for the existing corporate website. Each section maps to marked elements in
 * index.html (data-cms attributes). Defaults are the site's current content, so rendering with an
 * empty database reproduces today's pages exactly.
 */

export type FieldType = 'text' | 'textarea' | 'inline' | 'richtext' | 'url' | 'link' | 'email' | 'image' | 'boolean' | 'date' | 'list';

export interface FieldDef {
    key: string;
    label: string;
    type: FieldType;
    help?: string;
    max?: number;
    required?: boolean;
    /** For list fields: sub-fields of each item (or a single 'value' text field for string lists). */
    item?: FieldDef[];
    maxItems?: number;
}

export interface SectionDef {
    key: string;
    title: string;
    group: 'Site' | 'Homepage' | 'Platforms' | 'Company';
    description: string;
    fields: FieldDef[];
    defaults: Record<string, unknown>;
}

const text = (key: string, label: string, max = 200, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'text', max, required: true, ...extra });
const area = (key: string, label: string, max = 1200, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'textarea', max, required: true, ...extra });
const stringList = (key: string, label: string, maxItems = 12, max = 120): FieldDef => ({
    key, label, type: 'list', maxItems, item: [{ key: 'value', label, type: 'text', max, required: true }],
});

export const SECTIONS: SectionDef[] = [
    {
        key: 'site.seo',
        title: 'Search & social sharing',
        group: 'Site',
        description: 'Homepage title, description and the image shown when the site is shared.',
        fields: [
            text('title', 'Page title', 70, { help: 'Shown in browser tabs and search results. Aim for 50–60 characters.' }),
            area('description', 'Meta description', 320, { help: 'Shown under the title in search results. Search engines usually show about 155–160 characters.' }),
            text('ogTitle', 'Social share title', 90),
            area('ogDescription', 'Social share description', 200),
            { key: 'ogImage', label: 'Social share image (1200×630)', type: 'image' },
            text('ogImageAlt', 'Social share image description', 200),
        ],
        defaults: {
            title: 'SUSKII — Technology connecting people to commerce, services and travel',
            description: 'SUSKII is the parent brand of SUSKII Marketplace, SUSKII Errands and SUSKII Travel & Tours: independent digital platforms forming one connected ecosystem for everyday commerce, services and travel.',
            ogTitle: 'SUSKII — One ecosystem for commerce, services and travel',
            ogDescription: 'Meet the SUSKII ecosystem: SUSKII Marketplace, SUSKII Errands and SUSKII Travel & Tours.',
            ogImage: { url: 'https://suskii-website.vercel.app/assets/og/suskii-ecosystem.png', alt: '' },
            ogImageAlt: 'SUSKII ecosystem: Marketplace, Errands, and Travel & Tours',
        },
    },
    {
        key: 'home.hero',
        title: 'Hero',
        group: 'Homepage',
        description: 'The first screen: headline, introduction and buttons.',
        fields: [
            text('eyebrow', 'Badge text', 60),
            text('titleLead', 'Headline — opening words', 80),
            text('titleCommerce', 'Headline — orange word', 30),
            text('titleServices', 'Headline — teal word', 30),
            text('titleJoin', 'Headline — joining word', 20),
            text('titleTravel', 'Headline — indigo word', 30),
            area('lead', 'Introduction', 400),
            text('primaryCta', 'Primary button label', 40),
            text('secondaryCta', 'Secondary button label', 40),
        ],
        defaults: {
            eyebrow: 'The SUSKII ecosystem',
            titleLead: 'Connecting people to',
            titleCommerce: 'commerce,',
            titleServices: 'services',
            titleJoin: 'and',
            titleTravel: 'travel.',
            lead: 'SUSKII is a technology company building independent digital platforms that work together, so buying, selling, getting things done and going places all start in one trusted ecosystem.',
            primaryCta: 'Explore Our Platforms',
            secondaryCta: 'About SUSKII',
        },
    },
    {
        key: 'home.ecosystem',
        title: 'Our Ecosystem',
        group: 'Homepage',
        description: 'How the parent brand and its platforms fit together.',
        fields: [text('eyebrow', 'Eyebrow', 40), text('title', 'Heading', 160), area('lead', 'Introduction', 600)],
        defaults: {
            eyebrow: 'Our Ecosystem',
            title: 'One parent brand. Independent platforms. A connected experience.',
            lead: 'SUSKII is the home of a growing family of digital products. Each platform is focused on one everyday need and runs as its own product, while all of them share the same SUSKII foundations: trust, simplicity and a commitment to the communities they serve.',
        },
    },
    {
        key: 'home.platforms',
        title: 'Our Platforms — introduction',
        group: 'Homepage',
        description: 'Heading above the three platform showcases.',
        fields: [text('eyebrow', 'Eyebrow', 40), text('title', 'Heading', 160), area('lead', 'Introduction', 400)],
        defaults: {
            eyebrow: 'Our Platforms',
            title: 'Three platforms. Each built for one everyday need.',
            lead: 'Every SUSKII platform has its own identity, team focus and product roadmap, and every one follows the same SUSKII standards.',
        },
    },
    {
        key: 'platform.marketplace',
        title: 'SUSKII Marketplace',
        group: 'Platforms',
        description: 'Marketplace showcase on the homepage.',
        fields: [
            text('category', 'Category', 60), text('title', 'Headline', 120), area('description', 'Description', 600),
            stringList('features', 'Features', 8),
            { key: 'banner', label: 'Showcase image (optional — replaces the phone illustration)', type: 'image' },
        ],
        defaults: {
            category: 'Online P2P Marketplace',
            title: 'A market for anything salable.',
            description: 'An online marketplace where individuals and businesses can buy and sell virtually anything. SUSKII Marketplace is a digital market hub connecting buyers and sellers, from gadgets and fashion to property and vehicles.',
            features: ['Buy and sell products', 'Individual and business sellers', 'Product discovery and search', 'Marketplace listings', 'Buyer and seller connections'].map((value) => ({ value })),
            banner: null,
        },
    },
    {
        key: 'platform.errands',
        title: 'SUSKII Errands',
        group: 'Platforms',
        description: 'Errands showcase on the homepage.',
        fields: [
            text('category', 'Category', 60), text('title', 'Headline', 120), area('description', 'Description', 600),
            stringList('features', 'Features', 8), area('note', 'Availability note', 300),
            { key: 'banner', label: 'Showcase image (optional — replaces the phone illustration)', type: 'image' },
        ],
        defaults: {
            category: 'Services Marketplace',
            title: 'Rendering All Available Services.',
            description: 'A platform where users can discover, request and access different services. SUSKII Errands connects people who need services with individuals and businesses offering those services.',
            features: ['Request different services', 'Discover available service providers', 'Browse service categories', 'Connect customers with service providers', 'Service discovery and booking'].map((value) => ({ value })),
            note: 'The SUSKII Errands website and apps are not public yet. We’ll share the links here when they launch.',
            banner: null,
        },
    },
    {
        key: 'platform.travel_tour',
        title: 'SUSKII Travel & Tours',
        group: 'Platforms',
        description: 'Travel & Tours showcase on the homepage.',
        fields: [
            text('category', 'Category', 60), text('title', 'Headline', 120), area('description', 'Description', 600),
            stringList('features', 'Planned features', 8),
            { key: 'notice', label: 'Availability notice (bold allowed)', type: 'inline', max: 300, required: true },
            { key: 'banner', label: 'Showcase image (optional — replaces the concept illustration)', type: 'image' },
        ],
        defaults: {
            category: 'Travel and Tourism',
            title: 'The next journey for the SUSKII ecosystem.',
            description: 'An upcoming travel platform designed to make travel planning, bookings and tourism services accessible through the SUSKII ecosystem.',
            features: ['Flight booking', 'Hotel reservations', 'Car rentals', 'Intercity transportation', 'Travel and tourism services'].map((value) => ({ value })),
            notice: 'SUSKII Travel &amp; Tours is in development. Bookings are <strong>not yet available</strong>.',
            banner: null,
        },
    },
    {
        key: 'home.why',
        title: 'Why SUSKII',
        group: 'Homepage',
        description: 'The five reasons tiles.',
        fields: [
            text('eyebrow', 'Eyebrow', 40), text('title', 'Heading', 160),
            { key: 'tiles', label: 'Tiles (first tile is the large one)', type: 'list', maxItems: 5, item: [text('title', 'Title', 60), area('text', 'Text', 300)] },
        ],
        defaults: {
            eyebrow: 'Why SUSKII',
            title: 'Everyday digital services, brought together.',
            tiles: [
                { title: 'One vision for everyday life', text: 'We’re building one trusted ecosystem where the services people rely on every day (shopping, help at home, getting around) are all within reach.' },
                { title: 'Convenience', text: 'Every SUSKII platform shares one family of design and standards, so moving between them feels familiar from the first tap.' },
                { title: 'Accessibility', text: 'Mobile-first products designed for the devices and connections people actually use, and free to browse.' },
                { title: 'Innovation', text: 'Modern digital products built for local markets, from smarter discovery to new ways of requesting services and planning travel.' },
                { title: 'Connectivity', text: 'We connect buyers with sellers, customers with service providers and travellers with journeys, creating opportunity on both sides.' },
            ],
        },
    },
    {
        key: 'home.about',
        title: 'About SUSKII',
        group: 'Company',
        description: 'Company introduction, facts, vision, mission and commitment.',
        fields: [
            text('eyebrow', 'Eyebrow', 40), text('title', 'Heading', 160), area('lead', 'Introduction', 800),
            text('platformsCount', 'Fact — Platforms', 20), text('liveToday', 'Fact — Live today', 60),
            { key: 'offices', label: 'Fact — Office locations', type: 'list', maxItems: 8, item: [text('value', 'Location', 60), { key: 'muted', label: 'Show as upcoming (lighter text)', type: 'boolean' }] },
            area('vision', 'Our vision', 400), area('mission', 'Our mission', 400), area('commitment', 'Our commitment', 400),
        ],
        defaults: {
            eyebrow: 'About SUSKII',
            title: 'Building useful technology for the way people live.',
            lead: 'SUSKII started with a simple idea: a market for anything salable. Today it is growing into a family of platforms for the everyday needs that matter most: trading, getting things done and travelling. We build carefully, launch when products are ready, and put people first.',
            platformsCount: '3',
            liveToday: 'Nigeria & Rwanda',
            offices: [
                { value: 'Kigali, Rwanda', muted: false },
                { value: 'Lagos, Nigeria', muted: false },
                { value: 'Across Africa', muted: false },
                { value: 'Globally soon', muted: true },
            ],
            vision: 'To be the trusted digital ecosystem people across Africa turn to for everyday commerce, services and travel.',
            mission: 'To build useful, accessible platforms that connect people and businesses to opportunity, and make everyday transactions simpler, safer and closer to home.',
            commitment: 'Trust and safety first. Honest communication about what is available today and what is coming next. Products shipped only when they are ready to serve people well.',
        },
    },
    {
        key: 'home.faq',
        title: 'Frequently asked questions',
        group: 'Homepage',
        description: 'Questions and answers. Answers may contain links, bold and italic text.',
        fields: [
            text('title', 'Heading', 120),
            { key: 'items', label: 'Questions', type: 'list', maxItems: 20, item: [text('question', 'Question', 200), { key: 'answer', label: 'Answer', type: 'inline', max: 1500, required: true }] },
        ],
        defaults: {
            title: 'Frequently asked questions',
            items: [
                { question: 'What is SUSKII?', answer: 'SUSKII is a technology company and the parent brand of SUSKII Marketplace, SUSKII Errands and SUSKII Travel &amp; Tours. Each is an independent platform within the SUSKII ecosystem.' },
                { question: 'Which SUSKII platforms can I use today?', answer: 'SUSKII Marketplace is live on the web at <a href="https://suskii.com/" target="_blank" rel="noopener">suskii.com</a> and on Android via <a href="https://play.google.com/store/apps/details?id=com.plugz.suskii.app&amp;hl=en_AU" target="_blank" rel="noopener">Google Play</a>. SUSKII Errands is coming soon, and SUSKII Travel &amp; Tours is in development.' },
                { question: 'Is there an iPhone app?', answer: 'Not yet. SUSKII Marketplace for iOS is coming soon. Until then, iPhone users can use the Marketplace on the web at suskii.com.' },
                { question: 'Where is SUSKII available?', answer: 'SUSKII Marketplace is currently available in Nigeria and Rwanda, with plans to expand to more countries.' },
                { question: 'Is SUSKII free to use?', answer: 'Creating an account and browsing products on SUSKII Marketplace is free.' },
                { question: 'Can I book travel with SUSKII yet?', answer: 'No. SUSKII Travel &amp; Tours is in development and bookings are not yet available. Register your interest and we’ll let you know when it launches.' },
            ],
        },
    },
    {
        key: 'home.partners',
        title: 'Partners',
        group: 'Company',
        description: 'Partner and sponsor logos shown after the FAQ.',
        fields: [
            text('title', 'Heading', 120),
            {
                key: 'items', label: 'Partners', type: 'list', maxItems: 12,
                item: [text('name', 'Name', 80), { key: 'logo', label: 'Logo', type: 'image', required: true }, { key: 'url', label: 'Website', type: 'url', required: true }, text('domain', 'Website label', 80), text('role', 'Role label', 30)],
            },
        ],
        defaults: {
            title: 'In partnership with.',
            items: [
                { name: 'My Eya Homes', logo: { url: 'assets/partners/my-eya-homes.webp', alt: 'My Eya Homes — Estate & Investments', width: 373, height: 240 }, url: 'https://myeyahomes.com/', domain: 'myeyahomes.com', role: 'Partner' },
                { name: 'Eya Autos', logo: { url: 'assets/partners/eya-autos.webp', alt: 'Eya Autos — Premium cars, global standards', width: 533, height: 200 }, url: 'https://eyaautos.com/', domain: 'eyaautos.com', role: 'Partner' },
            ],
        },
    },
    {
        key: 'site.contact',
        title: 'Contact information',
        group: 'Site',
        description: 'Email and office shown in the Contact section and footer.',
        fields: [
            text('title', 'Contact heading', 80),
            { key: 'email', label: 'Email', type: 'email', required: true },
            text('emailHint', 'Email description', 100),
            text('officeTitle', 'Office (short)', 80),
            text('officeHint', 'Office details', 120),
            text('officeFooter', 'Office (footer)', 120),
            { key: 'mapsUrl', label: 'Map link', type: 'url', required: true },
        ],
        defaults: {
            title: 'Talk to SUSKII.',
            email: 'support@suskii.com',
            emailHint: 'Support, partnerships and press',
            officeTitle: 'Kisimenti, Kigali',
            officeHint: 'Opposite Jollof Kigali · Open in Google Maps',
            officeFooter: 'Kisimenti, Kigali, Rwanda',
            mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kigali%20Kisimenti%2C%20Opposite%20Jollof%20Kigali',
        },
    },
    {
        key: 'site.social',
        title: 'Social media links',
        group: 'Site',
        description: 'Profiles linked from the Contact section and footer. Leave empty to hide an icon.',
        fields: [
            { key: 'facebook', label: 'Facebook', type: 'url' },
            { key: 'instagram', label: 'Instagram', type: 'url' },
            { key: 'tiktok', label: 'TikTok', type: 'url' },
            { key: 'linkedin', label: 'LinkedIn', type: 'url' },
        ],
        defaults: {
            facebook: 'https://www.facebook.com/profile.php?id=61592829380893',
            instagram: 'https://www.instagram.com/suskiiapp',
            tiktok: 'https://www.tiktok.com/@suskii2026',
            linkedin: 'https://www.linkedin.com/in/suskii2026/',
        },
    },
    {
        key: 'site.footer',
        title: 'Footer',
        group: 'Site',
        description: 'Footer description and copyright name.',
        fields: [area('description', 'Description', 300), text('copyrightName', 'Copyright name', 60)],
        defaults: {
            description: 'SUSKII is a technology company building digital platforms that connect people and businesses to commerce, services and travel.',
            copyrightName: 'SUSKII',
        },
    },
];

export const SECTION_BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]));

export const NEWS_FIELDS: FieldDef[] = [
    text('title', 'Title', 160),
    area('summary', 'Summary', 300, { help: 'Shown in the news list and search results.' }),
    { key: 'body', label: 'Article', type: 'richtext', max: 40000, required: true },
    { key: 'cover', label: 'Cover image', type: 'image' },
    text('author', 'Author', 80, { required: false }),
    { key: 'date', label: 'Display date', type: 'date', required: true },
    text('seoTitle', 'SEO title (optional)', 70, { required: false }),
    area('seoDescription', 'SEO description (optional)', 170, { required: false }),
];

export const JOB_FIELDS: FieldDef[] = [
    text('title', 'Job title', 120),
    text('department', 'Department', 80),
    text('location', 'Location', 80),
    text('employment', 'Employment type', 40, { help: 'e.g. Full-time, Contract' }),
    area('summary', 'Summary', 300),
    { key: 'body', label: 'Description', type: 'richtext', max: 40000, required: true },
    { key: 'applyOpen', label: 'Accept applications on the website', type: 'boolean' },
    { key: 'closingDate', label: 'Closing date (optional)', type: 'date' },
];

export const COLLECTION_FIELDS = { news: NEWS_FIELDS, job: JOB_FIELDS } as const;
