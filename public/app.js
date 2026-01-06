// public/app.js

async function toggleInterest(itemId) {
  const btn = document.querySelector("[data-interest-btn]");
  const countEl = document.querySelector("[data-interest-count]");

  // Support both icon types:
  // 1) <span data-like-icon>♡</span>
  // 2) <img data-like-icon-img src="...">
  const iconTextEl = document.querySelector("[data-like-icon]");
  const iconImgEl = document.querySelector("[data-like-icon-img]");

  if (!btn || !countEl) return;

  btn.disabled = true;

  try {
    const res = await fetch(`/api/items/${itemId}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (res.status === 401 || res.status === 403) {
      alert("Please log in to like items.");
      window.location.href = "/login";
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      alert(data.message || "Could not update interest.");
      return;
    }

    // Update count + state
    countEl.textContent = data.count;

    const isLiked = !!data.interested;
    btn.classList.toggle("liked", isLiked);
    btn.setAttribute("aria-pressed", isLiked ? "true" : "false");
    btn.setAttribute("aria-label", isLiked ? "Liked" : "Like");

    // Update icon
    if (iconTextEl) {
      iconTextEl.textContent = isLiked ? "♥" : "♡";
    }
    if (iconImgEl) {
      iconImgEl.src = isLiked
        ? "/public/icons/heart-filled.png"
        : "/public/icons/heart-outline.png";
      iconImgEl.alt = isLiked ? "Liked" : "Like";
    }
  } catch (e) {
    console.error(e);
    alert("Network error");
  } finally {
    btn.disabled = false;
  }
}

async function addToCart(itemId) {
  const btn = document.querySelector("[data-cart-btn]");
  if (!btn) return;

  const label = btn.querySelector(".icon-text");

  btn.disabled = true;

  try {
    const res = await fetch(`/api/items/${itemId}/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (res.status === 401 || res.status === 403) {
      alert("Please log in to add items to cart.");
      window.location.href = "/login";
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      alert(data.message || "Could not add to cart.");
      return;
    }

    btn.classList.add("ok");
    if (label) label.textContent = "Added ✓";
  } catch (e) {
    console.error(e);
    alert("Network error");
  } finally {
    // small delay so user sees feedback
    setTimeout(() => {
      btn.disabled = false;
    }, 400);
  }
}

function switchMainImage(src) {
  const img = document.querySelector("[data-main-image]");
  if (img) img.src = src;
}
