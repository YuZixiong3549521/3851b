import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { formatDate, formatMoney } from '@/lib/format';
import { dayBeforeDate } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate, nextWeekday } from '@/lib/booking-schedule';
import { apiFetch as fetch } from '../api';
import React, {
  useEffect,
  useState
} from 'react';

import type {
  Booking,
  User
} from '../types';

interface MyBookingsPageProps {
  user: User;
  onBackHome: () => void;
}

const MyBookingsPage:
  React.FC<MyBookingsPageProps> = ({
    user,
    onBackHome
  }) => {

  const [
    bookings,
    setBookings
  ] = useState<Booking[]>([]);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    error,
    setError
  ] = useState('');

  const [
    successMessage,
    setSuccessMessage
  ] = useState('');

  const [
    cancellingBookingId,
    setCancellingBookingId
  ] = useState<number | null>(null);

  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);

  const [
    editingBookingId,
    setEditingBookingId
  ] = useState<number | null>(null);

  const [
    editDate,
    setEditDate
  ] = useState('');

  const [
    editTime,
    setEditTime
  ] = useState('');

  const [
    savingBookingId,
    setSavingBookingId
  ] = useState<number | null>(null);
  const activeBookings = bookings.filter(booking => !['Completed', 'Cancelled'].includes(booking.booking_status));

  // =====================================
  // LOAD BOOKINGS
  // =====================================

  useEffect(() => {
    const loadBookings = async () => {
      try {
        setLoading(true);
        setError('');

        const response =
          await fetch(
            `/api/public/bookings/user/${user.id}`
          );

        const data =
          await response.json();

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.message ||
            'Unable to load bookings.'
          );
        }

        setBookings(
          data.bookings
        );
      } catch (err) {
        console.error(err);

        setError(
          'Unable to load your bookings. Please try again.'
        );
      } finally {
        setLoading(false);
      }
    };

    loadBookings();
  }, [user.id]);

  // =====================================
  // CANCEL BOOKING
  // =====================================

  const handleCancelBooking =
    async (
      bookingId: number
    ) => {

      try {
        setCancellingBookingId(
          bookingId
        );

        setError('');
        setSuccessMessage('');

        const response =
          await fetch(
            `/api/public/bookings/${bookingId}/status`,
            {
              method: 'PATCH',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  status:
                    'Cancelled'
                })
            }
          );

        const data =
          await response.json();

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.message ||
            'Unable to cancel booking.'
          );
        }

        setBookings(
          (
            previousBookings
          ) =>
            previousBookings.map(
              (booking) =>
                booking.id ===
                bookingId
                  ? {
                      ...booking,
                      booking_status:
                        'Cancelled'
                    }
                  : booking
            )
        );

        setSuccessMessage(
          'Booking cancelled successfully.'
        );

      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error ? err.message : 'Unable to cancel this booking. Please try again.'
        );

      } finally {
        setCancellingBookingId(
          null
        );
      }
    };

  // =====================================
  // START RESCHEDULE
  // =====================================

  const handleStartReschedule = (
    booking: Booking
  ) => {
    const visit = booking.annualBundle?.visits.find(item => item.bookingId === booking.id);
    const windowStart = booking.annualBundle?.windowStart ?? visit?.windowStart;
    const windowEnd = booking.annualBundle?.windowEnd ?? visit?.windowEnd;
    const earliest = earliestBookingDate();
    const firstAllowed = nextWeekday(windowStart && windowStart > earliest ? windowStart : earliest);
    const available = !windowEnd || firstAllowed < windowEnd;
    setEditingBookingId(
      booking.id
    );

    setEditDate(
      !bookingDateError(booking.preferred_date) ? booking.preferred_date : available ? firstAllowed : ''
    );

    setEditTime(
      booking.time_window
    );

    setError(available ? '' : 'There is no eligible weekday remaining in this visit’s quarterly window. Please contact the service team.');
    setSuccessMessage('');
  };

  // =====================================
  // CANCEL EDIT
  // =====================================

  const handleCancelReschedule =
    () => {

      setEditingBookingId(
        null
      );

      setEditDate('');
      setEditTime('');
      setError('');
    };

  // =====================================
  // SAVE RESCHEDULE
  // =====================================

  const handleSaveReschedule =
    async (
      bookingId: number
    ) => {

      if (
        !editDate ||
        !editTime
      ) {
        setError(
          'Please select a date and time.'
        );

        return;
      }
      const dateError = bookingDateError(editDate);
      if (dateError) { setError(dateError); return; }
      const current = bookings.find(booking => booking.id === bookingId);
      const visit = current?.annualBundle?.visits.find(item => item.bookingId === bookingId);
      const windowStart = current?.annualBundle?.windowStart ?? visit?.windowStart;
      const windowEnd = current?.annualBundle?.windowEnd ?? visit?.windowEnd;
      if ((windowStart && editDate < windowStart) || (windowEnd && editDate >= windowEnd)) {
        setError('Keep this visit within its quarterly date window.'); return;
      }

      try {
        setSavingBookingId(
          bookingId
        );

        setError('');
        setSuccessMessage('');

        const response =
          await fetch(
            `/api/public/bookings/${bookingId}/reschedule`,
            {
              method:
                'PATCH',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  preferredDate:
                    editDate,
                  timeWindow:
                    editTime
                })
            }
          );

        const data =
          await response.json();

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.message ||
            'Unable to reschedule booking.'
          );
        }

        setBookings(
          (
            previousBookings
          ) =>
            previousBookings.map(
              (booking) =>
                booking.id ===
                bookingId
                  ? {
                      ...booking,
                      preferred_date:
                        editDate,
                      time_window:
                        editTime
                    }
                  : booking
            )
        );

        setEditingBookingId(
          null
        );

        setEditDate('');
        setEditTime('');

        setSuccessMessage(
          'Preferred date updated. The service team will confirm availability.'
        );

      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error ? err.message : 'Unable to reschedule this booking. Please try again.'
        );

      } finally {
        setSavingBookingId(
          null
        );
      }
    };

  // =====================================
  // STATUS STYLE
  // =====================================

  const getStatusStyle = (
    status: string
  ) => {
    switch (
      status.toLowerCase()
    ) {
      case 'pending':
        return {
          background:
            '#fffaeb',
          color:
            '#b54708'
        };

      case 'confirmed':
        return {
          background:
            '#eff8ff',
          color:
            '#175cd3'
        };

      case 'in progress':
        return {
          background:
            '#f4f3ff',
          color:
            '#5925dc'
        };

      case 'completed':
        return {
          background:
            '#ecfdf3',
          color:
            '#027a48'
        };

      case 'cancelled':
        return {
          background:
            '#fef3f2',
          color:
            '#b42318'
        };

      default:
        return {
          background:
            '#f2f4f7',
          color:
            '#344054'
        };
    }
  };

  // =====================================
  // PAGE
  // =====================================

  return (
    <div
      style={{
        minHeight:
          '100vh',
        background:
          '#f5f7fc',
        padding:
          '50px 20px'
      }}
    >
      <div
        style={{
          maxWidth:
            '1000px',
          margin:
            '0 auto'
        }}
      >

        {/* Back */}

        <Button variant="ghost"
          onClick={
            onBackHome
          }
          style={{
            border:
              'none',
            background:
              'transparent',
            color:
              '#29498f',
            fontSize:
              '16px',
            cursor:
              'pointer',
            marginBottom:
              '25px',
            fontWeight:
              600
          }}
        >
          ← Back to Home
        </Button>

        {/* Title */}

        <div
          style={{
            marginBottom:
              '30px'
          }}
        >
          <h1
            style={{
              fontSize:
                '36px',
              marginBottom:
                '8px',
              color:
                '#101828'
            }}
          >
            My Bookings
          </h1>

          <p
            style={{
              color:
                '#667085',
              margin:
                0
            }}
          >
            View and manage your active service requests. Completed and cancelled bookings are kept in your booking history.
          </p>
          <a href="/customer/history" className="mt-3 inline-block text-sm font-semibold text-primary underline">View booking history</a>
        </div>

        {/* Success */}

        {successMessage && (
          <div
            style={{
              background:
                '#ecfdf3',
              color:
                '#027a48',
              padding:
                '16px',
              borderRadius:
                '10px',
              marginBottom:
                '20px',
              border:
                '1px solid #abefc6'
            }}
          >
            {
              successMessage
            }
          </div>
        )}

        {/* Loading */}

        {loading && (
          <div
            style={{
              background:
                'white',
              padding:
                '30px',
              borderRadius:
                '16px'
            }}
          >
            Loading your
            bookings...
          </div>
        )}

        {/* Error */}

        {error && (
          <div
            style={{
              background:
                '#fee4e2',
              color:
                '#b42318',
              padding:
                '16px',
              borderRadius:
                '10px',
              marginBottom:
                '20px'
            }}
          >
            {error}
          </div>
        )}

        {/* Empty */}

        {!loading &&
          !error &&
          activeBookings.length ===
            0 && (
            <div
              style={{
                background:
                  'white',
                padding:
                  '50px',
                borderRadius:
                  '16px',
                textAlign:
                  'center',
                boxShadow:
                  '0 4px 18px rgba(0,0,0,0.05)'
              }}
            >
              <div
                style={{
                  fontSize:
                    '42px',
                  marginBottom:
                    '15px'
                }}
              >
                ❄️
              </div>

              <h2>
                No active bookings
              </h2>

              <p
                style={{
                  color:
                    '#667085'
                }}
              >
                Your service
                bookings will
                appear here.
              </p>

              <Button variant="ghost"
                onClick={
                  onBackHome
                }
                style={{
                  marginTop:
                    '15px',
                  border:
                    'none',
                  background:
                    '#29498f',
                  color:
                    'white',
                  padding:
                    '12px 22px',
                  borderRadius:
                    '10px',
                  cursor:
                    'pointer',
                  fontWeight:
                    600
                }}
              >
                Book a Service
              </Button>
            </div>
          )}

        {/* Booking Cards */}

        {!loading &&
          activeBookings.map(
            (booking) => {

              const statusStyle =
                getStatusStyle(
                  booking
                    .booking_status
                );

              const isPending =
                booking
                  .booking_status
                  .toLowerCase() ===
                'submitted';

              const isEditing =
                editingBookingId ===
                booking.id;
              const annualVisit = booking.annualBundle?.visits.find(visit => visit.bookingId === booking.id);
              const windowStart = booking.annualBundle?.windowStart ?? annualVisit?.windowStart;
              const windowEnd = booking.annualBundle?.windowEnd ?? annualVisit?.windowEnd;
              const earliest = earliestBookingDate();
              const firstAllowed = nextWeekday(windowStart && windowStart > earliest ? windowStart : earliest);
              const hasAvailableDate = !windowEnd || firstAllowed < windowEnd;

              return (
                <div
                  key={
                    booking.id
                  }
                  style={{
                    background:
                      'white',
                    borderRadius:
                      '18px',
                    padding:
                      '28px',
                    marginBottom:
                      '22px',
                    boxShadow:
                      '0 4px 18px rgba(0,0,0,0.06)',
                    border:
                      '1px solid #eaecf0'
                  }}
                >

                  {/* Header */}

                  <div
                    style={{
                      display:
                        'flex',
                      justifyContent:
                        'space-between',
                      alignItems:
                        'flex-start',
                      gap:
                        '20px',
                      marginBottom:
                        '20px'
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          margin:
                            0,
                          color:
                            '#101828',
                          fontSize:
                            '22px'
                        }}
                      >
                        {
                          booking.annualBundle?.name || booking.service_package ||
                          booking.service_type
                        }
                      </h2>
                      {booking.annualBundle && <p className="mt-2 text-sm font-semibold text-primary">Visit {booking.annualBundle.visitNumber} of 4 · Quarterly cleaning</p>}

                      <p
                        style={{
                          color:
                            '#667085',
                          marginTop:
                            '6px',
                          marginBottom:
                            0
                        }}
                      >
                        Booking #
                        {
                          booking.id
                        }
                      </p>
                    </div>

                    <span
                      style={{
                        ...statusStyle,
                        padding:
                          '8px 14px',
                        borderRadius:
                          '20px',
                        fontWeight:
                          600,
                        fontSize:
                          '14px',
                        whiteSpace:
                          'nowrap'
                      }}
                    >
                      {
                        booking.booking_status
                      }
                    </span>
                  </div>

                  <hr
                    style={{
                      border:
                        'none',
                      borderTop:
                        '1px solid #eaecf0',
                      marginBottom:
                        '22px'
                    }}
                  />

                  {/* Grid */}

                  <div
                    style={{
                      display:
                        'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(220px, 1fr))',
                      gap:
                        '18px'
                    }}
                  >

                    {/* Service */}

                    <div>
                      <strong>
                        Service
                      </strong>

                      <div
                        style={{
                          color:
                            '#667085',
                          marginTop:
                            '5px'
                        }}
                      >
                        {
                          booking.service_type
                        }
                      </div>
                    </div>

                    {/* Date */}

                    <div>
                      <strong>
                        Date
                      </strong>

                      {isEditing ? (
                        <Input
                          type="date"
                          disabled={!hasAvailableDate}
                          min={firstAllowed}
                          aria-invalid={Boolean(editDate && bookingDateError(editDate))}
                          max={windowEnd ? dayBeforeDate(windowEnd) : undefined}
                          value={
                            editDate
                          }
                          onChange={(
                            e
                          ) => { setEditDate(e.target.value); setError(bookingDateError(e.target.value)); }}
                          style={{
                            display:
                              'block',
                            marginTop:
                              '8px',
                            width:
                              '100%',
                            boxSizing:
                              'border-box',
                            padding:
                              '10px 12px',
                            border:
                              '1px solid #d0d5dd',
                            borderRadius:
                              '8px',
                            fontSize:
                              '15px',
                            background:
                              'white'
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            color:
                              '#667085',
                            marginTop:
                              '5px'
                          }}
                        >
                          {
                            formatDate(booking.preferred_date)
                          }
                        </div>
                      )}
                    </div>

                    {/* Time */}

                    <div>
                      <strong>
                        Time
                      </strong>

                      {isEditing ? (
                        <NativeSelect
                          value={
                            editTime
                          }
                          onChange={(
                            e
                          ) =>
                            setEditTime(
                              e.target
                                .value
                            )
                          }
                          style={{
                            display:
                              'block',
                            marginTop:
                              '8px',
                            width:
                              '100%',
                            boxSizing:
                              'border-box',
                            padding:
                              '10px 12px',
                            border:
                              '1px solid #d0d5dd',
                            borderRadius:
                              '8px',
                            fontSize:
                              '15px',
                            background:
                              'white'
                          }}
                        >
                          <option value="">
                            Select
                            a time
                          </option>

                          <option value="09:00 AM - 11:00 AM">
                            09:00 AM
                            - 11:00 AM
                          </option>

                          <option value="11:00 AM - 01:00 PM">
                            11:00 AM
                            - 01:00 PM
                          </option>

                          <option value="02:00 PM - 04:00 PM">
                            02:00 PM
                            - 04:00 PM
                          </option>

                          <option value="04:00 PM - 06:00 PM">
                            04:00 PM
                            - 06:00 PM
                          </option>
                        </NativeSelect>
                      ) : (
                        <div
                          style={{
                            color:
                              '#667085',
                            marginTop:
                              '5px'
                          }}
                        >
                          {
                            booking.time_window
                          }
                        </div>
                      )}
                    </div>

                    {/* Units */}

                    <div>
                      <strong>
                        AC Units
                      </strong>

                      <div
                        style={{
                          color:
                            '#667085',
                          marginTop:
                            '5px'
                        }}
                      >
                        {
                          booking.number_of_units
                        }
                      </div>
                    </div>
                  </div>

                  {isEditing && <p className="mt-3 rounded-xl bg-primary/5 p-3 text-sm leading-6">{bookingScheduleNotice}</p>}
                  {isEditing && !hasAvailableDate && <p role="alert" className="mt-2 text-sm text-red-700">There is no eligible weekday remaining in this visit’s quarterly window. Please contact the service team.</p>}
                  {isEditing && editDate && bookingDateError(editDate) && <p role="alert" className="mt-2 text-sm text-red-700">{bookingDateError(editDate)}</p>}
                  <div className="mt-5 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm"><p className="font-semibold">{booking.annualBundle ? 'This visit estimate' : 'Visit estimate'}: {booking.total_amount == null ? 'To be confirmed' : formatMoney(booking.total_amount)}</p>{booking.annualBundle && <p className="mt-1 text-xs text-muted-foreground">{formatMoney(booking.annualBundle.totalAmount)} for all four visits. Pay after each service; additional work is quoted separately.</p>}</div>
                  {isEditing && windowStart && windowEnd && <p className="mt-3 text-sm text-muted-foreground">Keep this quarterly visit between {formatDate(windowStart)} and {formatDate(dayBeforeDate(windowEnd))}. Other visits retain their preferred dates.</p>}

                  {/* Address */}

                  <div
                    style={{
                      marginTop:
                        '22px'
                    }}
                  >
                    <strong>
                      Service Address
                    </strong>

                    <div
                      style={{
                        color:
                          '#667085',
                        marginTop:
                          '5px'
                      }}
                    >
                      {
                        booking.service_address
                      }
                    </div>
                  </div>

                  {/* Symptoms */}

                  {booking.symptoms && (
                    <div
                      style={{
                        marginTop:
                          '20px'
                      }}
                    >
                      <strong>
                        Problem /
                        Symptoms
                      </strong>

                      <div
                        style={{
                          color:
                            '#667085',
                          marginTop:
                            '5px'
                        }}
                      >
                        {
                          booking.symptoms
                        }
                      </div>
                    </div>
                  )}

                  {/* Notes */}

                  {booking.special_notes &&
                    booking.special_notes !==
                      booking.symptoms && (
                    <div
                      style={{
                        marginTop:
                          '20px'
                      }}
                    >
                      <strong>
                        Special Notes
                      </strong>

                      <div
                        style={{
                          color:
                            '#667085',
                          marginTop:
                            '5px'
                        }}
                      >
                        {
                          booking.special_notes
                        }
                      </div>
                    </div>
                  )}

                  {/* Actions */}

                  {isPending && (
                    <div
                      style={{
                        marginTop:
                          '28px',
                        paddingTop:
                          '20px',
                        borderTop:
                          '1px solid #eaecf0',
                        display:
                          'flex',
                        justifyContent:
                          'flex-end',
                        gap:
                          '12px',
                        flexWrap:
                          'wrap'
                      }}
                    >

                      {isEditing ? (
                        <>
                          <Button variant="ghost"
                            onClick={
                              handleCancelReschedule
                            }
                            disabled={
                              savingBookingId ===
                              booking.id
                            }
                            style={{
                              border:
                                '1px solid #d0d5dd',
                              background:
                                'white',
                              color:
                                '#344054',
                              padding:
                                '11px 18px',
                              borderRadius:
                                '10px',
                              cursor:
                                'pointer',
                              fontWeight:
                                600
                            }}
                          >
                            Cancel Edit
                          </Button>

                          <Button variant="ghost"
                            onClick={() =>
                              handleSaveReschedule(
                                booking.id
                              )
                            }
                            disabled={
                              !hasAvailableDate || !editDate || Boolean(bookingDateError(editDate)) ||
                              savingBookingId ===
                              booking.id
                            }
                            style={{
                              border:
                                'none',
                              background:
                                '#29498f',
                              color:
                                'white',
                              padding:
                                '11px 18px',
                              borderRadius:
                                '10px',
                              cursor:
                                savingBookingId ===
                                booking.id
                                  ? 'not-allowed'
                                  : 'pointer',
                              fontWeight:
                                600
                            }}
                          >
                            {
                              savingBookingId ===
                              booking.id
                                ? 'Saving...'
                                : 'Save Changes'
                            }
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost"
                            onClick={() =>
                              handleStartReschedule(
                                booking
                              )
                            }
                            style={{
                              border:
                                '1px solid #29498f',
                              background:
                                'white',
                              color:
                                '#29498f',
                              padding:
                                '11px 18px',
                              borderRadius:
                                '10px',
                              cursor:
                                'pointer',
                              fontWeight:
                                600
                            }}
                          >
                            Reschedule
                          </Button>

                          <Button variant="ghost"
                            onClick={() =>
                              setConfirmCancelId(booking.id)
                            }
                            disabled={
                              cancellingBookingId ===
                              booking.id
                            }
                            style={{
                              border:
                                '1px solid #f04438',
                              background:
                                cancellingBookingId ===
                                booking.id
                                  ? '#f2f4f7'
                                  : 'white',
                              color:
                                '#b42318',
                              padding:
                                '11px 18px',
                              borderRadius:
                                '10px',
                              cursor:
                                cancellingBookingId ===
                                booking.id
                                  ? 'not-allowed'
                                  : 'pointer',
                              fontWeight:
                                600
                            }}
                          >
                            {
                              cancellingBookingId ===
                              booking.id
                                ? 'Cancelling...'
                                : 'Cancel Booking'
                            }
                          </Button>
                          {confirmCancelId === booking.id && (
                            <div role="alert" style={{ width: '100%', color: '#b42318' }}>
                              <p>Are you sure you want to cancel this booking?</p>
                              <Button variant="ghost" type="button" onClick={() => setConfirmCancelId(null)} style={{ marginRight: 16, padding: 12 }}>Keep Booking</Button>
                              <Button variant="ghost" type="button" disabled={cancellingBookingId === booking.id} onClick={() => handleCancelBooking(booking.id)} style={{ padding: 12, fontWeight: 600 }}>Confirm Cancellation</Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            }
          )}
      </div>
    </div>
  );
};

export default MyBookingsPage;
