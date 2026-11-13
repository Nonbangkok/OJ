#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T1, T2> CP::pair<T1, T2>::operator+(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return CP::pair<T1, T2>();
}

template <typename T1, typename T2>
CP::pair<T1, T2> CP::pair<T1, T2>::doubled() const
{
  // You MAY need to edit this function
  return *this + *this;
}

#endif
