import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface ThemeState {
  allowDarkMode: boolean;

  lightPrimary: string;
  lightSecondary: string;

  darkPrimary: string;
  darkSecondary: string;

  logoLight: string;
  logoDark: string;

  faviconLight: string;
  faviconDark: string;
}

const initialState: ThemeState = {
  allowDarkMode: true,

  lightPrimary: "",
  lightSecondary: "",

  darkPrimary: "",
  darkSecondary: "",

  logoLight: "",
  logoDark: "",

  faviconLight: "",
  faviconDark: "",
};

const themeSlice = createSlice({
  name: "theme",

  initialState,

  reducers: {
    setTheme: (
      state,
      action: PayloadAction<ThemeState>
    ) => {
      return action.payload;
    },

    clearTheme: () => initialState,
  },
});

export const {
  setTheme,
  clearTheme,
} = themeSlice.actions;

export default themeSlice.reducer;