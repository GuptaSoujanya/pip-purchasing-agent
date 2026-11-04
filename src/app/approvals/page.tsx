import {
  getNode,
  getProduct,
  getRun,
  getSupplier,
  getValidations,
  listApprovals,
} from "@/lib/db/repo";
import ApprovalQueue from "./queue";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const approvals = listApprovals().map((a) => {
    const action = safeParse(a.action_json);
    const product =
      typeof action?.product_id === "string"
        ? getProduct(action.product_id)
        : null;
    const node =
      typeof action?.node_id === "string" ? getNode(action.node_id) : null;
    const supplier =
      typeof action?.supplier_id === "string"
        ? getSupplier(action.supplier_id)
        : null;
    const run = getRun(a.run_id);
    const input = run ? safeParse(run.input_json) : null;
    const original = input?.recommended_qty ?? input?.desired_qty;
    const requestedQty =
      typeof original === "number" &&
      Number.isFinite(original) &&
      original >= 0 &&
      input?.product_id === action?.product_id &&
      input?.node_id === action?.node_id
        ? original
        : undefined;
    const preValidation = getValidations(a.run_id)
      .filter((validation) => validation.phase === "pre")
      .at(-1);
    const checks = preValidation ? safeParse(preValidation.checks_json) : [];
    return {
      ...a,
      action,
      run,
      requested_qty: requestedQty,
      requested_label:
        input?.recommended_qty !== undefined
          ? "System recommendation"
          : "Requested quantity",
      validation_checks: Array.isArray(checks)
        ? checks
            .filter(
              (check) =>
                typeof check?.code === "string" &&
                typeof check?.label === "string" &&
                typeof check?.passed === "boolean" &&
                typeof check?.detail === "string",
            )
            .map((check) => ({
              code: check.code as string,
              label: check.label as string,
              passed: check.passed as boolean,
              detail: check.detail as string,
            }))
        : [],
      product_name: product?.name,
      product_sku: product?.sku,
      node_name: node?.name,
      supplier_name: supplier?.name,
    };
  });
  return <ApprovalQueue approvals={approvals} />;
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
