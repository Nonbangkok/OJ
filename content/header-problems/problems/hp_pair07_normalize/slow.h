// The naive-but-correct counterpart the harness asks every problem to carry.
//
// Ordering two components is O(1) whatever you do with it, so this problem
// has no complexity subtask: meta.json sets "has_tle_subtask": false and
// verify.py skips the TLE check for it. The file still has to exist, so it
// holds a genuinely correct implementation that takes the long road — it
// copies both components out, works out the order from the copies, and writes
// both components back every single time, whether or not anything moved. It
// is still idempotent, so it must produce exactly the reference's outputs; it
// is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
void CP::pair<T1, T2>::normalize()
{
  T1 low = first;
  T2 high = second;
  if (high < low)
  {
    T1 hold = low;
    low = high;
    high = hold;
  }
  first = low;
  second = high;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::sorted() const
{
  return !(second < first);
}

#endif
