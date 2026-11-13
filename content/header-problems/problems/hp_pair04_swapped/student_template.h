#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T2, T1> CP::pair<T1, T2>::swapped() const
{
  // Your code here
  return CP::pair<T2, T1>();
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::become(const CP::pair<T2, T1> &other)
{
  // You MAY need to edit this function
  CP::pair<T1, T2> flipped = other.swapped();
  first = flipped.first;
  second = flipped.second;
}

#endif
