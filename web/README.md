# Inventory Web App (Next.js + Supabase)

## Step 2: Run the web app

1. Copy `.env.example` to `.env.local`
2. Fill in Supabase URL / anon key
3. Install packages
4. Start dev server

```bash
cd web
npm install
npm run dev
```

## Notes

- This app uses the `apply_stock_transaction` RPC from `/supabase/schema.sql`
- The UI reads `parts` and `stock_transactions`
- Authentication UI is not added yet (policies currently require `authenticated`)

