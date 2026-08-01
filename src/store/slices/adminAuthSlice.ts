import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface AdminAuthState {
  isAuthenticated: boolean;
  tenantId: number | null;
  tenantCode: string;
  tenantName: string;
  userId: number | null;
  userCode: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

const initialState: AdminAuthState = {
  isAuthenticated: false,
  tenantId: null,
  tenantCode: "",
  tenantName: "",
  userId: null,
  userCode: "",
  firstName: "",
  lastName: "",
  email: "",
  role: "",
};

const adminAuthSlice = createSlice({
  name: "adminAuth",
  initialState,
  reducers: {
    adminLogin: (state, action) => {
      return {
        ...state,
        ...action.payload,
        isAuthenticated: true,
      };
    },
    adminLogout: () => initialState,
  },
});

export const { adminLogin, adminLogout } = adminAuthSlice.actions;
export default adminAuthSlice.reducer;
