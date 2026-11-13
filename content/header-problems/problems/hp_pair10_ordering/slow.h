// The naive-but-correct counterpart the harness asks every problem to carry.
//
// Six O(1) comparisons stay O(1) however they are written, so this problem has
// no complexity subtask: meta.json sets "has_tle_subtask": false and verify.py
// skips the TLE check for it. The file still has to exist, so it holds a
// genuinely correct implementation that takes the long road — every operator
// recomputes a full three-way comparison of both components from scratch
// instead of being derived from == and <. The six are still mutually
// consistent, so it must produce exactly the reference's outputs, zero law
// violations included; it is only wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

namespace
{
  // -1 when (a1, a2) comes first, +1 when (b1, b2) does, 0 when they tie.
  template <typename A, typename B>
  int three_way(const A &a1, const B &a2, const A &b1, const B &b2)
  {
    if (a1 < b1)
      return -1;
    if (b1 < a1)
      return 1;
    if (a2 < b2)
      return -1;
    if (b2 < a2)
      return 1;
    return 0;
  }
} // namespace

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator==(const CP::pair<T1, T2> &other) const
{
  return three_way(first, second, other.first, other.second) == 0;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator!=(const CP::pair<T1, T2> &other) const
{
  return three_way(first, second, other.first, other.second) != 0;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<(const CP::pair<T1, T2> &other) const
{
  return three_way(first, second, other.first, other.second) < 0;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<=(const CP::pair<T1, T2> &other) const
{
  return three_way(first, second, other.first, other.second) <= 0;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>(const CP::pair<T1, T2> &other) const
{
  return three_way(first, second, other.first, other.second) > 0;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>=(const CP::pair<T1, T2> &other) const
{
  return three_way(first, second, other.first, other.second) >= 0;
}

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::clamp(const CP::pair<T1, T2> &low,
                                                const CP::pair<T1, T2> &high) const
{
  if (*this < low)
    return low;
  if (high < *this)
    return high;
  return *this;
}

#endif
