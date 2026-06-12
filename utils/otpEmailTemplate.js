const otpEmailTemplate = (otp) => {
  // Split OTP into individual digit boxes
  const digits = String(otp).split('');
  const digitBoxes = digits
    .map(
      (d) => `
      <td style="padding:0 5px">
        <div style="
          width:46px;height:56px;
          background:#2D1B69;
          color:#C9A227;
          border-radius:10px;
          font-size:28px;font-weight:800;
          text-align:center;line-height:56px;
          font-family:'Courier New',monospace;
        ">${d}</div>
      </td>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Your Bingo OTP</title>
</head>
<body style="margin:0;padding:0;background:#F4F0FF;font-family:'Segoe UI',Arial,sans-serif">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0FF;padding:40px 16px">
    <tr><td align="center">

      <table width="520" cellpadding="0" cellspacing="0"
        style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #E2D9F3">

        <!-- ── Header ── -->
        <tr>
          <td style="background:#2D1B69;padding:36px 40px 28px;text-align:center">
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 6px">
              <tr>
                <td style="padding-right:10px">
                  <div style="width:36px;height:36px;background:#C9A227;border-radius:8px;text-align:center;line-height:36px;font-size:18px">&#9632;</div>
                </td>
                <td>
                  <span style="color:#C9A227;font-size:22px;font-weight:700;letter-spacing:.5px">BINGO</span>
                </td>
              </tr>
            </table>
            <p style="color:rgba(255,255,255,0.45);font-size:12px;margin:0;letter-spacing:.08em;text-transform:uppercase">multiplayer</p>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="padding:36px 40px 32px">

            <p style="color:#2D1B69;font-size:22px;font-weight:700;margin:0 0 6px">Reset your password</p>
            <p style="color:#888888;font-size:14px;margin:0 0 28px;line-height:1.6">
              Hi there! We received a request to reset the password for your Bingo account.
              Use the code below — it expires in <strong style="color:#2D1B69">10 minutes</strong>.
            </p>

            <!-- OTP Block -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#F9F6FF;border:1.5px dashed #C9A227;border-radius:14px;margin-bottom:28px">
              <tr>
                <td style="padding:28px 20px;text-align:center">
                  <p style="color:#AAAAAA;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 14px">
                    Your one-time code
                  </p>
                  <table cellpadding="0" cellspacing="0" style="margin:0 auto">
                    <tr>${digitBoxes}</tr>
                  </table>
                  <p style="color:#AAAAAA;font-size:12px;margin:14px 0 0">
                    Valid for 10 minutes &nbsp;·&nbsp; Do not share this code
                  </p>
                </td>
              </tr>
            </table>

            <!-- Warning -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#FFF8E1;border-left:3px solid #C9A227;border-radius:0 8px 8px 0;margin-bottom:28px">
              <tr>
                <td style="padding:12px 16px">
                  <p style="color:#7A5C00;font-size:13px;margin:0;line-height:1.5">
                    If you didn't request this, you can safely ignore this email. Your password won't change.
                  </p>
                </td>
              </tr>
            </table>

            <p style="color:#AAAAAA;font-size:12px;line-height:1.6;margin:0">
              This is an automated message from Bingo Multiplayer. Please do not reply to this email.
            </p>

          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#F9F6FF;border-top:1px solid #E2D9F3;padding:20px 40px;text-align:center">
            <p style="color:#BBBBBB;font-size:11px;margin:0;letter-spacing:.03em">
              &copy; 2026 BingoBing Multiplayer &nbsp;&middot;&nbsp; All rights reserved
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
};

module.exports ={otpEmailTemplate};