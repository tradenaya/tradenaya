import { createSlice } from "@reduxjs/toolkit";

interface ThemeState {
  allowDarkMode: boolean;
  defaultMode: string;

  lightPrimary: string;
  lightSecondary: string;
  lightAccent: string;
  lightBackground: string;
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

interface AuthState {
  isAuthenticated: boolean;

  loginType: string;

  tenantId: number | null;
  tenantCode: string;
  tenantName: string;

  profileId: number | null;

  firstName: string;
  lastName: string;

  email: string;

  role: string;

  theme: ThemeState | null;
}

const initialState: AuthState = {
  isAuthenticated: false,

  loginType: "",

  tenantId: null,
  tenantCode: "",
  tenantName: "",

  profileId: null,

  firstName: "",
  lastName: "",

  email: "",

  role: "",

  theme: null,
};

const authSlice = createSlice({
  name: "auth",

  initialState,

  reducers: {
    login: (state, action) => {
      return {
        ...state,
        ...action.payload,
        isAuthenticated: true,
      };
    },

    logout: () => initialState,
  },
});

export const {
  login,
  logout,
} = authSlice.actions;

export default authSlice.reducer;