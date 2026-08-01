import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { getDefaultAdminTheme } from "@/lib/theme-defaults";

export interface AdminThemeState {
  allowDarkMode: boolean;
  defaultMode: string;
  colorMode: "light" | "dark";
  lightPrimary: string;
  lightSecondary: string;
  lightAccent: string;
  lightSidebar: string;
  lightBackground: string;
  lightSurface: string;
  lightText: string;
  darkPrimary: string;
  darkSecondary: string;
  darkAccent: string;
  darkSidebar: string;
  darkBackground: string;
  darkSurface: string;
  darkText: string;
  logoLight: string;
  logoDark: string;
  faviconLight: string;
  faviconDark: string;
  appIconLight: string;
  appIconDark: string;
}

const initialState: AdminThemeState = {
  ...getDefaultAdminTheme(),
  colorMode: "dark",
};

const adminThemeSlice = createSlice({
  name: "adminTheme",
  initialState,
  reducers: {
    setAdminTheme: (state, action: PayloadAction<Partial<AdminThemeState>>) => {
      return { ...state, ...action.payload, colorMode: state.colorMode };
    },
    setColorMode: (state, action: PayloadAction<"light" | "dark">) => {
      state.colorMode = action.payload;
    },
    clearAdminTheme: () => initialState,
  },
});

export const { setAdminTheme, setColorMode, clearAdminTheme } = adminThemeSlice.actions;
export default adminThemeSlice.reducer;
