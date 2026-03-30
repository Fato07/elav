import React, { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ApprovalRequest } from "./types";

const TIMEOUT_SECONDS = 60;

interface ApprovalDialogProps {
  approval: ApprovalRequest | null;
  onApprove: (subtaskId: string) => void;
  onDeny: (subtaskId: string) => void;
}

function RiskIcon({ risk }: { risk: "low" | "medium" | "high" }) {
  switch (risk) {
    case "high":
      return <ShieldAlert className="h-5 w-5 text-red-500" />;
    case "medium":
      return <ShieldCheck className="h-5 w-5 text-amber-500" />;
    case "low":
      return <Shield className="h-5 w-5 text-blue-500" />;
  }
}

function riskVariant(risk: "low" | "medium" | "high"): "default" | "secondary" | "destructive" {
  switch (risk) {
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    case "low":
      return "default";
  }
}

export function ApprovalDialog({ approval, onApprove, onDeny }: ApprovalDialogProps) {
  const [countdown, setCountdown] = useState(TIMEOUT_SECONDS);

  useEffect(() => {
    if (!approval) return;
    setCountdown(TIMEOUT_SECONDS);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onDeny(approval.subtaskId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [approval?.subtaskId]);

  if (!approval) return null;

  return (
    <Dialog open={!!approval} onOpenChange={() => onDeny(approval.subtaskId)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiskIcon risk={approval.risk} />
            Approval Required
          </DialogTitle>
          <DialogDescription>
            The agent wants to perform a potentially risky action.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Risk level:</span>
            <Badge variant={riskVariant(approval.risk)} className="capitalize">
              {approval.risk}
            </Badge>
          </div>

          <div>
            <span className="text-sm text-muted-foreground">Action detected:</span>
            <code className="ml-2 px-2 py-0.5 rounded bg-muted text-sm font-mono">
              {approval.action}
            </code>
          </div>

          <div className="rounded-md border p-3 bg-muted/50 text-sm max-h-32 overflow-y-auto">
            {approval.description}
          </div>

          <p className="text-xs text-muted-foreground">
            Auto-denying in {countdown}s for safety.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onDeny(approval.subtaskId)}
          >
            Deny
          </Button>
          <Button
            variant={approval.risk === "high" ? "destructive" : "default"}
            onClick={() => onApprove(approval.subtaskId)}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
