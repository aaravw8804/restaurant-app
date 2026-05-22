"""
Restaurant App - Flask API
Deploy on Render (Free Tier) | Database on Supabase (PostgreSQL)
"""

import os
import jwt
import bcrypt
import stripe
import random
import string
import psycopg2
import psycopg2.extras
import requests as http_requests
from datetime import datetime, timedelta, timezone, date, time as time_type
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app, origins="*")

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
SECRET_KEY = os.getenv("SECRET_KEY", "fallback_secret")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FROM_EMAIL = os.getenv("FROM_EMAIL", "onboarding@resend.dev")

# ──────────────────────────────────────────────────────────
# DB CONNECTION
# ──────────────────────────────────────────────────────────
def get_db():
    return psycopg2.connect(
        os.getenv("DATABASE_URL"),
        cursor_factory=psycopg2.extras.RealDictCursor
    )

# ──────────────────────────────────────────────────────────
# JWT HELPERS
# ──────────────────────────────────────────────────────────
def create_token(user_id, role):
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if not token:
            return jsonify({"error": "Token required"}), 401
        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            request.user_id = data["sub"]
            request.user_role = data["role"]
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated

# ──────────────────────────────────────────────────────────
# EMAIL HELPER (Resend)
# ──────────────────────────────────────────────────────────
def send_otp_email(to_email, otp, name):
    try:
        response = http_requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "from": FROM_EMAIL,
                "to": [to_email],
                "subject": "Ember & Oak — Your Login OTP",
                "html": f"""
                <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                  <h2 style="color: #1a1a1a; font-weight: 400;">Ember <span style="color: #c8622a;">&amp;</span> Oak</h2>
                  <p style="color: #444; font-size: 16px;">Hello {name},</p>
                  <p style="color: #444; font-size: 16px;">Your one-time login code is:</p>
                  <div style="background: #f5f0eb; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
                    <span style="font-size: 40px; font-weight: 600; letter-spacing: 12px; color: #1a1a1a;">{otp}</span>
                  </div>
                  <p style="color: #888; font-size: 14px;">This code expires in 10 minutes. Do not share it with anyone.</p>
                </div>
                """
            }
        )
        return response.status_code == 200
    except Exception as e:
        print(f"Email error: {e}")
        return False

# ──────────────────────────────────────────────────────────
# JSON SERIALIZATION HELPER
# ──────────────────────────────────────────────────────────
import decimal

def serialize_row(row):
    """Convert psycopg2 RealDictRow to a JSON-safe dict."""
    result = {}
    for k, v in row.items():
        if isinstance(v, (datetime, date)):
            result[k] = v.isoformat()
        elif isinstance(v, time_type):
            result[k] = v.strftime("%H:%M:%S")
        elif isinstance(v, decimal.Decimal):
            result[k] = float(v)
        else:
            result[k] = v
    return result
@app.route("/api/auth/register", methods=["POST"])
def register():
    body = request.json or {}
    name = body.get("name", "").strip()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    phone = body.get("phone", "")

    if not all([name, email, password]):
        return jsonify({"error": "name, email and password are required"}), 400

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (name, email, phone, password_hash) VALUES (%s,%s,%s,%s) RETURNING id, name, email, role",
                    (name, email, phone, hashed)
                )
                user = dict(cur.fetchone())
                conn.commit()
        return jsonify({"message": "Registration successful. Please log in."}), 201
    except psycopg2.errors.UniqueViolation:
        return jsonify({"error": "Email already registered"}), 409

# ──────────────────────────────────────────────────────────
# AUTH — LOGIN (step 1: verify password, send OTP)
# ──────────────────────────────────────────────────────────
@app.route("/api/auth/login", methods=["POST"])
def login():
    body = request.json or {}
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            user = cur.fetchone()

    if not user or not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        return jsonify({"error": "Invalid Credentials"}), 401

    # Generate 6-digit OTP
    otp = "".join(random.choices(string.digits, k=6))
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    with get_db() as conn:
        with conn.cursor() as cur:
            # Clear old OTPs for this user
            cur.execute("DELETE FROM otps WHERE user_id = %s", (user["id"],))
            cur.execute(
                "INSERT INTO otps (user_id, otp_code, expires_at) VALUES (%s, %s, %s)",
                (user["id"], otp, expires_at)
            )
            conn.commit()

    # Send OTP via email
    sent = send_otp_email(email, otp, user["name"])
    if not sent:
        return jsonify({"error": "Failed to send OTP email. Check RESEND_API_KEY."}), 500

    return jsonify({"message": "OTP sent to your email", "email": email}), 200

# ──────────────────────────────────────────────────────────
# AUTH — VERIFY OTP (step 2: verify OTP, issue JWT)
# ──────────────────────────────────────────────────────────
@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    body = request.json or {}
    email = body.get("email", "").strip().lower()
    otp_code = body.get("otp", "").strip()

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            user = cur.fetchone()
            if not user:
                return jsonify({"error": "User not found"}), 404

            cur.execute("""
                SELECT * FROM otps
                WHERE user_id = %s AND otp_code = %s AND expires_at > NOW()
            """, (user["id"], otp_code))
            otp_row = cur.fetchone()

            if not otp_row:
                return jsonify({"error": "Invalid or expired OTP"}), 401

            # Delete used OTP
            cur.execute("DELETE FROM otps WHERE user_id = %s", (user["id"],))
            conn.commit()

    token = create_token(user["id"], user["role"])
    return jsonify({
        "token": token,
        "user": {
            "id": str(user["id"]),
            "name": user["name"],
            "email": user["email"],
            "role": user["role"]
        }
    })

# ──────────────────────────────────────────────────────────
# MENU
# ──────────────────────────────────────────────────────────
@app.route("/api/menu", methods=["GET"])
def get_menu():
    category = request.args.get("category")
    with get_db() as conn:
        with conn.cursor() as cur:
            if category:
                cur.execute("""
                    SELECT mi.*, mc.name AS category_name
                    FROM menu_items mi
                    LEFT JOIN menu_categories mc ON mi.category_id = mc.id
                    WHERE mi.is_available = TRUE AND mc.name ILIKE %s
                    ORDER BY mc.display_order, mi.name
                """, (f"%{category}%",))
            else:
                cur.execute("""
                    SELECT mi.*, mc.name AS category_name
                    FROM menu_items mi
                    LEFT JOIN menu_categories mc ON mi.category_id = mc.id
                    WHERE mi.is_available = TRUE
                    ORDER BY mc.display_order, mi.name
                """)
            items = [dict(r) for r in cur.fetchall()]
    return jsonify({"menu": items})

@app.route("/api/menu/categories", methods=["GET"])
def get_categories():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM menu_categories ORDER BY display_order")
            cats = [dict(r) for r in cur.fetchall()]
    return jsonify({"categories": cats})

@app.route("/api/menu/<item_id>", methods=["GET"])
def get_menu_item(item_id):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM menu_items WHERE id = %s", (item_id,))
            item = cur.fetchone()
    if not item:
        return jsonify({"error": "Item not found"}), 404
    return jsonify(dict(item))

# ──────────────────────────────────────────────────────────
# ORDERS
# ──────────────────────────────────────────────────────────
@app.route("/api/orders", methods=["POST"])
@token_required
def create_order():
    body = request.json or {}
    items = body.get("items", [])
    order_type = body.get("order_type", "dine_in")
    table_id = body.get("table_id")
    delivery_address = body.get("delivery_address")
    notes = body.get("notes", "")

    if not items:
        return jsonify({"error": "Order must have at least one item"}), 400

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                subtotal = 0
                validated_items = []
                for item in items:
                    cur.execute("SELECT id, name, price FROM menu_items WHERE id = %s AND is_available = TRUE", (item["menu_item_id"],))
                    mi = cur.fetchone()
                    if not mi:
                        return jsonify({"error": f"Menu item {item['menu_item_id']} not found"}), 404
                    qty = int(item.get("quantity", 1))
                    subtotal += float(mi["price"]) * qty
                    validated_items.append({"id": mi["id"], "price": float(mi["price"]), "qty": qty, "instructions": item.get("special_instructions", "")})

                tax = round(subtotal * 0.05, 2)
                total = round(subtotal + tax, 2)

                cur.execute("""
                    INSERT INTO orders (user_id, table_id, order_type, subtotal, tax, total, delivery_address, notes)
                    VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """, (request.user_id, table_id, order_type, subtotal, tax, total, delivery_address, notes))
                order_id = cur.fetchone()["id"]

                for vi in validated_items:
                    cur.execute("""
                        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, special_instructions)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (order_id, vi["id"], vi["qty"], vi["price"], vi["instructions"]))

                conn.commit()
        return jsonify({"order_id": str(order_id), "subtotal": subtotal, "tax": tax, "total": total}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/orders/my", methods=["GET"])
@token_required
def get_my_orders():
    date_filter = request.args.get("date")
    type_filter = request.args.get("order_type")
    diet_filter = request.args.get("diet")  # "veg" or "nonveg"

    with get_db() as conn:
        with conn.cursor() as cur:
            query = """
                SELECT o.id, o.order_type, o.status, o.subtotal, o.tax, o.total,
                       o.payment_status, o.created_at,
                       json_agg(json_build_object(
                           'name', mi.name,
                           'qty', oi.quantity,
                           'price', oi.unit_price,
                           'is_vegetarian', mi.is_vegetarian,
                           'is_vegan', mi.is_vegan,
                           'image_url', mi.image_url
                       )) AS items
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                JOIN menu_items mi ON mi.id = oi.menu_item_id
                WHERE o.user_id = %s::uuid
            """
            params = [request.user_id]

            if date_filter:
                query += " AND DATE(o.created_at) = %s"
                params.append(date_filter)
            if type_filter:
                query += " AND o.order_type = %s"
                params.append(type_filter)

            query += " GROUP BY o.id ORDER BY o.created_at DESC"

            cur.execute(query, params)
            orders = [serialize_row(r) for r in cur.fetchall()]

            # Diet filter (post-query since it's per-item)
            if diet_filter == "veg":
                orders = [o for o in orders if all(i["is_vegetarian"] or i["is_vegan"] for i in o["items"])]
            elif diet_filter == "nonveg":
                orders = [o for o in orders if any(not i["is_vegetarian"] and not i["is_vegan"] for i in o["items"])]

    return jsonify({"orders": orders})

@app.route("/api/orders/<order_id>", methods=["GET"])
@token_required
def get_order(order_id):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM orders WHERE id = %s AND user_id = %s", (order_id, request.user_id))
            order = cur.fetchone()
            if not order:
                return jsonify({"error": "Order not found"}), 404
            cur.execute("""
                SELECT oi.*, mi.name, mi.image_url
                FROM order_items oi
                JOIN menu_items mi ON oi.menu_item_id = mi.id
                WHERE oi.order_id = %s
            """, (order_id,))
            order_items = [serialize_row(r) for r in cur.fetchall()]
    result = serialize_row(order)
    result["items"] = order_items
    return jsonify(result)

# ──────────────────────────────────────────────────────────
# RESERVATIONS
# ──────────────────────────────────────────────────────────
@app.route("/api/reservations", methods=["POST"])
@token_required
def create_reservation():
    body = request.json or {}
    required = ["guest_name", "guest_email", "party_size", "reserved_date", "reserved_time"]
    if not all(body.get(f) for f in required):
        return jsonify({"error": f"Missing required fields: {required}"}), 400

    party_size = int(body["party_size"])

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id FROM restaurant_tables
                    WHERE capacity >= %s
                    AND id NOT IN (
                        SELECT table_id FROM reservations
                        WHERE reserved_date = %s
                        AND reserved_time BETWEEN (%s::time - interval '90 minutes') AND (%s::time + interval '90 minutes')
                        AND status NOT IN ('cancelled')
                        AND table_id IS NOT NULL
                    )
                    ORDER BY capacity ASC LIMIT 1
                """, (party_size, body["reserved_date"], body["reserved_time"], body["reserved_time"]))
                table = cur.fetchone()
                table_id = table["id"] if table else None

                cur.execute("""
                    INSERT INTO reservations (user_id, table_id, guest_name, guest_email, guest_phone,
                        party_size, reserved_date, reserved_time, special_requests)
                    VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, status
                """, (
                    request.user_id, table_id, body["guest_name"], body["guest_email"],
                    body.get("guest_phone"), party_size, body["reserved_date"],
                    body["reserved_time"], body.get("special_requests", "")
                ))
                res = dict(cur.fetchone())
                conn.commit()
        return jsonify({
            "reservation_id": str(res["id"]),
            "status": res["status"],
            "table_assigned": table_id is not None,
            "message": "Reservation confirmed!" if table_id else "Reservation received, table to be assigned."
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/reservations/my", methods=["GET"])
@token_required
def get_my_reservations():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.*, rt.table_number, rt.location
                FROM reservations r
                LEFT JOIN restaurant_tables rt ON rt.id = r.table_id
                WHERE r.user_id = %s::uuid
                ORDER BY r.reserved_date DESC, r.reserved_time DESC
            """, (request.user_id,))
            reservations = [serialize_row(r) for r in cur.fetchall()]
    return jsonify({"reservations": reservations})

@app.route("/api/reservations/check-availability", methods=["GET"])
def check_availability():
    date = request.args.get("date")
    party_size = request.args.get("party_size", 2)
    if not date:
        return jsonify({"error": "date is required"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) AS available_tables FROM restaurant_tables
                WHERE capacity >= %s
                AND id NOT IN (
                    SELECT table_id FROM reservations
                    WHERE reserved_date = %s AND status NOT IN ('cancelled') AND table_id IS NOT NULL
                )
            """, (party_size, date))
            result = cur.fetchone()
    return jsonify({"date": date, "available_tables": result["available_tables"]})

# ──────────────────────────────────────────────────────────
# PAYMENTS (Stripe)
# ──────────────────────────────────────────────────────────
@app.route("/api/payments/create-intent", methods=["POST"])
@token_required
def create_payment_intent():
    body = request.json or {}
    order_id = body.get("order_id")
    if not order_id:
        return jsonify({"error": "order_id required"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT total FROM orders WHERE id = %s", (order_id,))
            order = cur.fetchone()
    if not order:
        return jsonify({"error": "Order not found"}), 404

    try:
        intent = stripe.PaymentIntent.create(
            amount=int(float(order["total"]) * 100),
            currency="inr",
            metadata={"order_id": order_id}
        )
        return jsonify({"client_secret": intent.client_secret})
    except stripe.error.StripeError as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/payments/webhook", methods=["POST"])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, os.getenv("STRIPE_WEBHOOK_SECRET"))
    except (ValueError, stripe.error.SignatureVerificationError):
        return jsonify({"error": "Invalid signature"}), 400

    if event["type"] == "payment_intent.succeeded":
        pi = event["data"]["object"]
        order_id = pi["metadata"].get("order_id")
        if order_id:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE orders SET payment_status='paid', payment_reference=%s WHERE id=%s",
                        (pi["id"], order_id)
                    )
                    conn.commit()
    return jsonify({"received": True})

# ──────────────────────────────────────────────────────────
# HEALTH CHECK
# ──────────────────────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.dst).isoformat})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_ENV") == "development")