"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

function PositionHistoryScreen() {
  return (
    <Card>
      <CardContent>
        <h3 className="font-medium text-lg">Position History</h3>
        <p className="text-sm text-muted-foreground">
          Position history data will appear here once positions are closed.
        </p>
      </CardContent>
    </Card>
  );
}

export default function PositionHistoryPage() {
  return (
    <div className="p-6">
      <PositionHistoryScreen />
    </div>
  );
}