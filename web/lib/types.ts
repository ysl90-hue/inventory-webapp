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
  is_b_grade: boolean;
  normal_stock?: number;
  b_grade_stock?: number;
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
  is_b_grade: boolean;
  created_at: string;
  actor_name?: string | null;
  parts?: {
    id?: string;
    item_number: string;
    designation: string;
    current_stock?: number;
    location?: string | null;
    is_b_grade?: boolean;
  } | null;
};

export type PartCategory = {
  id: string;
  name: string;
  created_at: string;
};
