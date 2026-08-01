import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface TenantState {
  tenantId: number | null;
  tenantCode: string;
  tenantName: string;
}

const initialState: TenantState = {
  tenantId: null,
  tenantCode: "",
  tenantName: "",
};

const tenantSlice = createSlice({
  name: "tenant",

  initialState,

  reducers: {
    setTenant: (
      state,
      action: PayloadAction<TenantState>
    ) => {
      return action.payload;
    },

    clearTenant: () => initialState,
  },
});

export const {
  setTenant,
  clearTenant,
} = tenantSlice.actions;

export default tenantSlice.reducer;
