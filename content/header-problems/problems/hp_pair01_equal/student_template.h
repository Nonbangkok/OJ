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
void CP::pair<T1, T2>::set(const T1 &a, const T2 &b)
{
  // You MAY need to edit this function
  first = a;
  second = b;
}

#endif
