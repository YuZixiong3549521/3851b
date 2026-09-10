const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const db = require("./database");

const app = express();
const PORT = 3001;

// ========================================
// MIDDLEWARE
// ========================================

app.use(
  cors({
    origin: "http://localhost:3000"
  })
);

app.use(express.json());

// ========================================
// TEST ROUTE
// ========================================

app.get("/", (req, res) => {
  res.send("AC Care Backend is running");
});

// ========================================
// REGISTER API
// ========================================

app.post("/api/register", async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      confirmPassword
    } = req.body;

    if (
      !fullName ||
      !email ||
      !password ||
      !confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields."
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    db.get(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail],
      async (err, existingUser) => {
        if (err) {
          console.error(
            "Registration database error:",
            err
          );

          return res.status(500).json({
            success: false,
            message: "Database error."
          });
        }

        if (existingUser) {
          return res.status(409).json({
            success: false,
            message:
              "An account with this email already exists."
          });
        }

        try {
          const hashedPassword =
            await bcrypt.hash(password, 10);

          db.run(
            `
            INSERT INTO users
            (
              full_name,
              email,
              phone,
              password
            )
            VALUES (?, ?, ?, ?)
            `,
            [
              fullName.trim(),
              normalizedEmail,
              phone ? phone.trim() : null,
              hashedPassword
            ],
            function (insertErr) {
              if (insertErr) {
                console.error(
                  "Unable to create account:",
                  insertErr
                );

                return res.status(500).json({
                  success: false,
                  message:
                    "Unable to create account."
                });
              }

              return res.status(201).json({
                success: true,
                message:
                  "Registration successful.",
                user: {
                  id: this.lastID,
                  fullName: fullName.trim(),
                  email: normalizedEmail,
                  phone:
                    phone
                      ? phone.trim()
                      : null
                }
              });
            }
          );
        } catch (hashError) {
          console.error(
            "Password hashing error:",
            hashError
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to process password."
          });
        }
      }
    );
  } catch (error) {
    console.error(
      "Registration server error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});

// ========================================
// LOGIN API
// ========================================

app.post("/api/login", (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter your email and password."
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    db.get(
      `
      SELECT
        id,
        full_name,
        email,
        phone,
        password
      FROM users
      WHERE email = ?
      `,
      [normalizedEmail],
      async (err, user) => {
        if (err) {
          console.error(
            "Login database error:",
            err
          );

          return res.status(500).json({
            success: false,
            message: "Database error."
          });
        }

        if (!user) {
          return res.status(401).json({
            success: false,
            message:
              "Invalid email or password."
          });
        }

        try {
          const passwordMatches =
            await bcrypt.compare(
              password,
              user.password
            );

          if (!passwordMatches) {
            return res.status(401).json({
              success: false,
              message:
                "Invalid email or password."
            });
          }

          return res.status(200).json({
            success: true,
            message: "Login successful.",
            user: {
              id: user.id,
              fullName: user.full_name,
              email: user.email,
              phone: user.phone
            }
          });
        } catch (compareError) {
          console.error(
            "Password comparison error:",
            compareError
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to verify password."
          });
        }
      }
    );
  } catch (error) {
    console.error(
      "Login server error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});

// ========================================
// CREATE BOOKING API
// ========================================

app.post("/api/bookings", (req, res) => {
  try {
    const {
      userId,
      serviceType,
      servicePackage,
      numberOfUnits,
      preferredDate,
      timeWindow,
      serviceAddress,
      symptoms,
      specialNotes
    } = req.body;

    if (
      !userId ||
      !serviceType ||
      !preferredDate ||
      !timeWindow ||
      !serviceAddress
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please complete all required booking fields."
      });
    }

    const sql = `
      INSERT INTO bookings (
        user_id,
        service_type,
        service_package,
        number_of_units,
        preferred_date,
        time_window,
        service_address,
        symptoms,
        special_notes,
        booking_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      userId,
      serviceType,
      servicePackage || null,
      numberOfUnits || 1,
      preferredDate,
      timeWindow,
      serviceAddress,
      symptoms || null,
      specialNotes || null,
      "Pending"
    ];

    db.run(
      sql,
      values,
      function (err) {
        if (err) {
          console.error(
            "Booking database error:",
            err
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to create booking."
          });
        }

        return res.status(201).json({
          success: true,
          message:
            "Booking created successfully.",
          booking: {
            id: this.lastID,
            userId,
            serviceType,
            servicePackage:
              servicePackage || null,
            numberOfUnits:
              numberOfUnits || 1,
            preferredDate,
            timeWindow,
            serviceAddress,
            symptoms:
              symptoms || null,
            specialNotes:
              specialNotes || null,
            status: "Pending"
          }
        });
      }
    );
  } catch (error) {
    console.error(
      "Booking server error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});

// ========================================
// GET USER BOOKINGS API
// ========================================

app.get(
  "/api/bookings/user/:userId",
  (req, res) => {
    const userId =
      req.params.userId;

    db.all(
      `
      SELECT *
      FROM bookings
      WHERE user_id = ?
      ORDER BY created_at DESC
      `,
      [userId],
      (err, rows) => {
        if (err) {
          console.error(
            "Unable to load bookings:",
            err
          );

          return res.status(500).json({
            success: false,
            message:
              "Unable to load bookings."
          });
        }

        return res.status(200).json({
          success: true,
          bookings: rows
        });
      }
    );
  }
);

// ========================================
// UPDATE BOOKING STATUS API
// ========================================

app.patch(
  "/api/bookings/:bookingId/status",
  (req, res) => {
    try {
      const bookingId =
        req.params.bookingId;

      const {
        status
      } = req.body;

      const allowedStatuses = [
        "Pending",
        "Confirmed",
        "In Progress",
        "Completed",
        "Cancelled"
      ];

      if (!status) {
        return res.status(400).json({
          success: false,
          message:
            "Booking status is required."
        });
      }

      if (
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid booking status."
        });
      }

      db.get(
        `
        SELECT *
        FROM bookings
        WHERE id = ?
        `,
        [bookingId],
        (findErr, booking) => {
          if (findErr) {
            console.error(
              "Booking lookup error:",
              findErr
            );

            return res.status(500).json({
              success: false,
              message:
                "Unable to find booking."
            });
          }

          if (!booking) {
            return res.status(404).json({
              success: false,
              message:
                "Booking not found."
            });
          }

          db.run(
            `
            UPDATE bookings
            SET booking_status = ?
            WHERE id = ?
            `,
            [
              status,
              bookingId
            ],
            function (updateErr) {
              if (updateErr) {
                console.error(
                  "Booking update error:",
                  updateErr
                );

                return res.status(500).json({
                  success: false,
                  message:
                    "Unable to update booking."
                });
              }

              return res.status(200).json({
                success: true,
                message:
                  "Booking status updated successfully.",
                booking: {
                  ...booking,
                  booking_status:
                    status
                }
              });
            }
          );
        }
      );
    } catch (error) {
      console.error(
        "Booking status server error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error."
      });
    }
  }
);

// ========================================
// RESCHEDULE BOOKING API
// ========================================

app.patch(
  "/api/bookings/:bookingId/reschedule",
  (req, res) => {
    try {
      const bookingId =
        req.params.bookingId;

      const {
        preferredDate,
        timeWindow
      } = req.body;

      if (
        !preferredDate ||
        !timeWindow
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Preferred date and time window are required."
        });
      }

      db.get(
        `
        SELECT *
        FROM bookings
        WHERE id = ?
        `,
        [bookingId],
        (findErr, booking) => {
          if (findErr) {
            console.error(
              "Reschedule lookup error:",
              findErr
            );

            return res.status(500).json({
              success: false,
              message:
                "Unable to find booking."
            });
          }

          if (!booking) {
            return res.status(404).json({
              success: false,
              message:
                "Booking not found."
            });
          }

          if (
            booking.booking_status !==
            "Pending"
          ) {
            return res.status(400).json({
              success: false,
              message:
                "Only pending bookings can be rescheduled."
            });
          }

          db.run(
            `
            UPDATE bookings
            SET
              preferred_date = ?,
              time_window = ?
            WHERE id = ?
            `,
            [
              preferredDate,
              timeWindow,
              bookingId
            ],
            function (updateErr) {
              if (updateErr) {
                console.error(
                  "Reschedule update error:",
                  updateErr
                );

                return res.status(500).json({
                  success: false,
                  message:
                    "Unable to reschedule booking."
                });
              }

              return res.status(200).json({
                success: true,
                message:
                  "Booking rescheduled successfully.",
                booking: {
                  ...booking,
                  preferred_date:
                    preferredDate,
                  time_window:
                    timeWindow
                }
              });
            }
          );
        }
      );
    } catch (error) {
      console.error(
        "Reschedule server error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error."
      });
    }
  }
);

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {
  console.log(
    `AC Care Backend running at http://localhost:${PORT}`
  );
});