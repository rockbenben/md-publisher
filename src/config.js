/** Platform configuration: URLs, selectors, and login checks */

export const PLATFORMS = {
  sspai: {
    name: '少数派',
    icon: '/icons/sspai.ico',
    url: 'https://sspai.com/write',
    // Editor-specific elements are the most reliable login indicator
    loggedInSelector: 'input[placeholder*="标题"], .sspai-header-user, [class*="avatar"]',
    // Login check — use homepage (lighter, doesn't create draft)
    checkUrl: 'https://sspai.com',
    checkSelector: '.ss__custom__header__user__avatar',
    // Username from avatar img alt: <button class="ss__custom__header__user__avatar"> > img[alt="用户名"]
    usernameJs: 'document.querySelector(".ss__custom__header__user__avatar img")?.alt || ""',
  },
  zhihu: {
    name: '知乎',
    icon: '/icons/zhihu.ico',
    url: 'https://zhuanlan.zhihu.com/write',
    loggedInSelector: 'textarea[placeholder*="标题"], .AppHeader-profile, .AppHeader-profileAvatar, .PublishEditor',
    loginUrlPattern: /signin|login/,
    checkUrl: 'https://www.zhihu.com',
    checkSelector: '.AppHeader-profileAvatar, .AppHeader-profileEntry',
    // Username from avatar img alt: "点击打开XXX的主页"
    usernameJs: '(document.querySelector(".AppHeader-profileAvatar")?.alt || "").replace("点击打开","").replace("的主页","")',
  },
  wechat: {
    name: '公众号',
    icon: '/icons/wechat.png',
    url: 'https://mp.weixin.qq.com/',
    converterUrl: 'https://md.doocs.org/',
    loggedInSelector: '.weui-desktop-account__nickname, .new-creation__menu, [class*="nickname"]',
    // /cgi-bin/home is the logged-in dashboard — do NOT include it here
    loginUrlPattern: /\/cgi-bin\/loginpage/,
    checkSelector: '.weui-desktop-account__nickname, [class*="nickname"]',
    usernameSelector: '.weui-desktop-account__nickname',
  },
  smzdm: {
    name: '什么值得买',
    icon: '/icons/smzdm.ico',
    url: 'https://post.smzdm.com/tougao/',
    // "发布新文章" link is the most reliable indicator on tougao page
    loggedInSelector: 'a[href*="/edit/"], .release-new, .J_user_name',
    checkUrl: 'https://zhiyou.smzdm.com/user/',
    checkSelector: '.info-stuff-nickname, .nav-username.J_nav_username',
    usernameSelector: '.info-stuff-nickname, .nav-username.J_nav_username',
  },
  juejin: {
    name: '掘金',
    icon: '/icons/juejin.svg',
    url: 'https://juejin.cn/editor/drafts/new?v=2',
    // Editor elements confirm both login AND page ready
    loggedInSelector: '.title-input, .bytemd, .bytemd-editor',
    checkUrl: 'https://juejin.cn',
    checkSelector: '.avatar-wrapper',
    // Username from avatar img alt: "XXX的头像"
    usernameJs: '(document.querySelector(".avatar-wrapper img")?.alt || "").replace(/的头像$/, "")',
  },
  x: {
    name: 'X',
    icon: '/icons/x.png',
    url: 'https://x.com/',
    loggedInSelector: '[data-testid="AppTabBar_Profile_Link"], [data-testid="SideNav_AccountSwitcher_Button"]',
    loginUrlPattern: /\/i\/flow\/login/,
    checkSelector: '[data-testid="AppTabBar_Profile_Link"]',
    hidden: true, // X only posts custom text, not article content — hide from default UI
  },
};

export const TIMEOUTS = {
  navigation: 30000,
  selector: 10000,
  login: 300000, // 5 minutes for manual login
  // Paste timing — clipboard API has no reliable DOM event to wait on,
  // so fixed delays are necessary. These values are tuned for typical machines;
  // increase if paste fails on slow systems.
  pasteBeforeKeys: 200,  // after click, before Ctrl+A/V — let editor gain focus
  pasteBetweenKeys: 100, // between Ctrl+A and Ctrl+V — let selection complete
  pasteAfterKeys: 300,   // after Ctrl+V — let editor process clipboard content
};
