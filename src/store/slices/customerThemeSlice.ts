import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { getDefaultCustomerTheme } from "@/lib/theme-defaults";

export interface CustomerThemeState {
  allowDarkMode: boolean;
  defaultMode: string;
  colorMode: "light" | "dark";
  lightPrimary: string;
  lightSecondary: string;
  lightAccent: string;
  lightBackground: string;
  lightSurface: string;
  lightText: string;
  darkPrimary: string;
  darkSecondary: string;
  darkAccent: string;
  darkBackground: string;
  darkSurface: string;
  darkText: string;
  logoLight: string;
  logoDark: string;
  faviconLight: string;
  faviconDark: string;
  appIconLight: string;
  appIconDark: string;
  loginBackgroundLight: string;
  loginBackgroundDark: string;
}

const initialState: CustomerThemeState = {
  ...getDefaultCustomerTheme(),
  colorMode: "dark",
};

const customerThemeSlice = createSlice({
  name: "customerTheme",
  initialState,
  reducers: {
    setCustomerTheme: (state, action: PayloadAction<Partial<CustomerThemeState>>) => {
      return { ...state, ...action.payload, colorMode: state.colorMode };
    },
    setColorMode: (state, action: PayloadAction<"light" | "dark">) => {
      state.colorMode = action.payload;
    },
    clearCustomerTheme: () => initialState,
  },
});

export const { setCustomerTheme, setColorMode, clearCustomerTheme } = customerThemeSlice.actions;
export default customerThemeSlice.reducer;
