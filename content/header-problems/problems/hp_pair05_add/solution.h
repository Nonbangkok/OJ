// Reference solution: a fresh pair built from the two component-wise sums,
// with *this on the left of each + so that a non-commutative component (a
// std::string, where + is concatenation) comes out in the right order.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T1, T2> CP::pair<T1, T2>::operator+(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return CP::pair<T1, T2>(first + other.first, second + other.second);
}

template <typename T1, typename T2>
CP::pair<T1, T2> CP::pair<T1, T2>::doubled() const
{
  // You MAY need to edit this function
  return *this + *this;
}

#endif
