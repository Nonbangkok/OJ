#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator==(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return false;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator!=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return false;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return false;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return false;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return false;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return false;
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
