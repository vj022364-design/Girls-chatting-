LOVE CONNECT — Real Login + Razorpay integration (Hindi)

इस संस्करण में:
- Login heading से “Demo” हटाया गया है।
- Create Account, Login, Logout और current session endpoints जोड़े गए हैं।
- Password bcrypt hash के रूप में database में रखा जाता है।
- Sessions SQLite store में रखे जाते हैं।
- Payment के लिए login आवश्यक है।
- Order को user ID से जोड़ा जाता है और signature server पर verify होता है।
- Successful verification पर user की membership expiry database में 6 महीने आगे सेट होती है।
- 18+ age confirmation checkbox जोड़ा गया है।

DEPLOYMENT (महत्वपूर्ण):
1. यह ZIP GitHub Pages पर अकेले काम नहीं करेगी क्योंकि GitHub Pages Node.js server नहीं चलाता।
2. इसे Node.js hosting पर deploy करें (उदाहरण: Render paid service / अन्य persistent Node.js host).
3. Persistent disk/storage जोड़ें और DB_PATH को उस disk के अंदर रखें, जैसे /var/data/loveconnect.sqlite. SQLite database और sessions.sqlite को persistent storage पर रखें।
4. Environment variables सेट करें:
   NODE_ENV=production
   SESSION_SECRET=<कम से कम 32 अक्षरों का random secret>
   RAZORPAY_KEY_ID=rzp_live_... (आपकी Live Key ID)
   RAZORPAY_KEY_SECRET=<Live Key Secret; केवल hosting settings में>
   DB_PATH=/var/data/loveconnect.sqlite (यदि persistent disk /var/data पर mount है)
5. Build command: npm install
   Start command: npm start
6. Razorpay account verification/activation पूरा होना चाहिए। पहले Razorpay test mode में flow जाँचें, फिर Live keys पर जाएँ।
7. Secret key को HTML, GitHub या chat में कभी न रखें।

LIMITATIONS / production checklist:
- यह basic real account system है, लेकिन production launch से पहले email verification, password reset, login rate limiting, CSRF protection, privacy policy/terms, monitoring और backup जोड़ें।
- SQLite storage persistent होना चाहिए; ephemeral host filesystem पर user accounts restart/redeploy पर खो सकते हैं।
- Payment verification uses Razorpay signature. For stronger production reconciliation, add Razorpay webhook handling and fetch payment/order status from Razorpay API before granting membership.
- Actual chat/voice/video calls अभी implemented नहीं हैं।
- Login के लिए real email/password account बनेगा; age checkbox is self-attestation, not independent age verification.
