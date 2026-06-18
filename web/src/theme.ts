import type { ThemeConfig } from 'antd';

// --- Palette mirrored from web/src/styles/global.css.
// Single dominant neutral (warm paper + ink) with one sharp accent (cinnabar).
export const C = {
  paper: '#F6F1E7',
  paperRaised: '#FCFAF3',
  ink: '#1C1A17',
  inkSoft: '#5C564C',
  inkFaint: '#8A8276',
  rule: '#DAD2C2',
  cinnabar: '#C23B2E',
  cinnabarDeep: '#9E2D22',
  sealWash: 'rgba(194,59,46,0.08)',
  airmail: '#2E5077',
  verdigris: '#3F7A4E',
  slugBg: '#191714',
  slugFg: '#E8E1D2',
} as const;

// antd v6 ships CSS variables on by default. We keep components as the
// accessible interaction base and push the *look* through seed tokens +
// per-component overrides so nothing reads as "stock antd". Fonts come from the
// single source in global.css via the --font-ui CSS variable.
export const theme: ThemeConfig = {
  token: {
    colorPrimary: C.cinnabar,
    colorInfo: C.airmail,
    colorSuccess: C.verdigris,
    colorError: C.cinnabarDeep,
    colorBgBase: C.paper,
    colorTextBase: C.ink,
    colorBorder: C.rule,
    colorBorderSecondary: C.rule,
    colorTextSecondary: C.inkSoft,
    colorTextTertiary: C.inkFaint,
    colorTextPlaceholder: C.inkFaint,
    // Near-square corners read as letterpress / print, not antd's signature 6px.
    borderRadius: 2,
    borderRadiusLG: 2,
    borderRadiusSM: 2,
    borderRadiusXS: 1,
    fontFamily: 'var(--font-ui)',
    fontSize: 14,
    controlHeight: 36,
    wireframe: false,
    boxShadow: '0 1px 0 rgba(28,26,23,0.04)',
    boxShadowSecondary: '0 8px 28px -12px rgba(28,26,23,0.28)',
  },
  components: {
    Button: {
      fontWeight: 600,
      primaryShadow: 'none',
      defaultShadow: 'none',
      controlHeight: 36,
      controlHeightLG: 46,
      colorBgContainer: C.paperRaised,
    },
    Checkbox: {
      borderRadiusSM: 1,
      colorPrimary: C.cinnabar,
    },
    Input: {
      colorBgContainer: C.paperRaised,
      activeShadow: '0 0 0 2px rgba(194,59,46,0.12)',
      paddingBlock: 7,
    },
    Modal: {
      contentBg: C.paperRaised,
      headerBg: C.paperRaised,
      titleColor: C.ink,
      borderRadiusLG: 2,
    },
    Switch: {
      colorPrimary: C.cinnabar,
      colorPrimaryHover: C.cinnabarDeep,
    },
    Tooltip: {
      colorBgSpotlight: C.ink,
      borderRadius: 2,
    },
    Message: {
      contentBg: C.ink,
      colorText: C.paper,
      borderRadiusLG: 2,
    },
    Tag: {
      defaultBg: C.sealWash,
      defaultColor: C.cinnabarDeep,
      borderRadiusSM: 1,
    },
    Empty: {
      colorTextDescription: C.inkFaint,
    },
  },
};
