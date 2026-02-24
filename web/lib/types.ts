export type Part = {
  id: string;
  position: string | null;
  item_number: string;
  designation: string;
  quantity: number;
  unit_of_quantity: string | null;
  spare_parts_identifier: string | null;
  current_stock: number;
  minimum_stock: number;
  location: string | null;
  created_at: string;
  updated_at: string;
};

export type StockTransaction = {
  id: string;
  part_id: string;
  created_by?: string | null;
  tx_type: "IN" | "OUT" | "ADJUST";
  qty: number;
  memo: string | null;
  created_at: string;
  actor_name?: string | null;
  parts?: {
    item_number: string;
    designation: string;
  } | null;
};
