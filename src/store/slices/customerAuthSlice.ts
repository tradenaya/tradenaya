import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface CustomerAuthState {
  isAuthenticated: boolean;
  tenantId: number | null;
  tenantCode: string;
  tenantName: string;
  profileId: number | null;
  profileCode: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

const initialState: CustomerAuthState = {
  isAuthenticated: false,
  tenantId: null,
  tenantCode: "",
  tenantName: "",
  profileId: null,
  profileCode: "",
  firstName: "",
  lastName: "",
  email: "",
  role: "",
};

const customerAuthSlice = createSlice({
  name: "customerAuth",
  initialState,
  reducers: {
    customerLogin: (state, action) => {
      return {
        ...state,
        ...action.payload,
        isAuthenticated: true,
      };
    },
    customerLogout: () => initialState,
  },
});

export const { customerLogin, customerLogout } = customerAuthSlice.actions;
export default customerAuthSlice.reducer;
