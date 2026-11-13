// Reference solution: write the two primitives honestly — == and < — and
// derive the other four from them. That is what makes the six mutually
// consistent by construction rather than by luck:
//
//   a != b   is   !(a == b)
//   a > b    is   b < a
//   a <= b   is   !(b < a)
//   a >= b   is   !(a < b)
//
// Only the components' own < is used for the ordering, so this works for
// every T1/T2 the grader instantiates, std::string included.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator==(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return !(first < other.first) && !(other.first < first) &&
         !(second < other.second) && !(other.second < second);
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator!=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return !(*this == other);
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<(const CP::pair<T1, T2> &other) const
{
  // Your code here
  if (first < other.first)
    return true;
  if (other.first < first)
    return false;
  return second < other.second;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return !(other < *this);
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return other < *this;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return !(*this < other);
}

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::clamp(const CP::pair<T1, T2> &low,
                                                const CP::pair<T1, T2> &high) const
{
  // You MAY need to edit this function
  if (*this < low)
    return low;
  if (high < *this)
    return high;
  return *this;
}

#endif
