
import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client

# Load env from parent directory if needed, or current
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: SUPABASE_URL or SUPABASE_KEY not found in .env")
    sys.exit(1)

supabase: Client = create_client(url, key)

try:
    response = supabase.table('rate_limit_configs').select("*").limit(1).execute()
    print("Success: rate_limit_configs table exists.")
    print(f"Row count: {len(response.data)}")
except Exception as e:
    print(f"Error accessing rate_limit_configs: {e}")
    print("You may need to run the SQL migration in supabase-schema.sql")
