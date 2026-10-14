/**
 * Signal Atlas Design Tokens (Master Product Design Brief v1.0, Sections 03-05)
 */
export const SIGNAL_ATLAS_COLORS = {
  canvas: "#F7F9FC",
  surfacePrimary: "#FFFFFF",
  surfaceSecondary: "#F0F4FA",
  inkPrimary: "#17243A",
  inkBody: "#30415D",
  inkMuted: "#64748B",
  inkSubtle: "#7B899F",
  borderDefault: "#DFE6F0",
  borderStrong: "#C7D2E3",
  accentPrimary: "#5157D9",
  accentPrimaryHover: "#4047BD",
  accentPrimarySoft: "#ECEEFF",
  accentPrimaryBorder: "#CED3FF",
  signalTeal: "#168E99",
  signalTealSoft: "#E7F6F7",
  statusSuccess: "#147D63",
  statusSuccessSoft: "#E7F6EF",
  statusWarning: "#A66A16",
  statusWarningSoft: "#FFF5E5",
  statusCritical: "#BF4256",
  statusCriticalSoft: "#FDECEF",
  showcaseBg: "#10192B",
  showcaseSurface: "#19243B",
  showcaseInkPrimary: "#F7F9FE",
  showcaseInkSecondary: "#B8C5DC",
} as const;

export const SIGNAL_ATLAS_SPACING_SCALE = [
  4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120,
] as const;

export const SIGNAL_ATLAS_GEOMETRY = {
  sidebarWidthPx: 256,
  headerHeightPx: 64,
  maxContentWidthPx: 1480,
  marketingMaxWidthPx: 1240,
  radiusControlPx: 10,
  radiusCardPx: 16,
  radiusDialogPx: 20,
  radiusBadgePx: 7,
} as const;
