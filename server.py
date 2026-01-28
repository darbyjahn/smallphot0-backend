from flask import Flask, request, jsonify
import stripe

app = Flask(__name__)

# Replace this with your Stripe secret key
stripe.api_key = "sk_test_YOUR_SECRET_KEY"

@app.route("/create-checkout-session", methods=["POST"])
def create_checkout_session():
    data = request.get_json()
    items = data["items"]

    line_items = []
    for item in items:
        line_items.append({
            "price_data": {
                "currency": "usd",
                "product_data": {"name": item["name"]},
                "unit_amount": int(item["price"] * 100),
            },
            "quantity": item["qty"],
        })

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=line_items,
        mode="payment",
        success_url="http://localhost:5000/success",
        cancel_url="http://localhost:5000/cart"
    )

    return jsonify({"id": session.id})

if __name__ == "__main__":
    app.run(port=5000, debug=True)
