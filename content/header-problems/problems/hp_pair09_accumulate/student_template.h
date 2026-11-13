#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T1, T2> &CP::pair<T1, T2>::operator+=(const CP::pair<T1, T2> &other)
{
  // Your code here
  return *this;
}

template <typename T1, typename T2>
CP::pair<T1, T2> &CP::pair<T1, T2>::absorb_twice(const CP::pair<T1, T2> &other)
{
  // You MAY need to edit this function
  *this += other;
  *this += other;
  return *this;
}

#endif
